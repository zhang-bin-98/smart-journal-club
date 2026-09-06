import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createSlide } from '../../modules/deck/mutations';
import type { DeckSession } from '../../modules/deck/DeckSession';
import type { DeckMutation, RevisionScope } from '../../modules/deck/deck.schema';
import type { Deck, Element } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../../app/activity';
import { errorMessage } from '../controls';
import type { TextEdit } from './SlidePreview';
import type { CancelAi } from './AiPanel';

/** 编辑器控制器：Deck 会话命令、选择状态、草稿保存队列、AI 接线与导出任务；组件只保留渲染与面板 UI 状态。 */
export function useEditorController({ session, paper, readOnly, resourceAvailable, initialSlideId, onSelection, onSource, onExport, registerLeaveGuard }: {
  session: DeckSession; paper: Paper; readOnly: boolean; resourceAvailable: boolean; initialSlideId?: string;
  onSelection?: (id?: string) => Promise<void>;
  onSource?: (sourceId: string, element: Extract<Element, { type: 'figure' }> | undefined, slideId: string, crop: boolean, apply: (element: Extract<Element, { type: 'figure' }>) => Promise<void>, onDraft: () => void) => void;
  onExport: (deck: Deck) => Promise<void>;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSlideId ?? session.current.slides[0]?.id);
  const [selectedElement, setSelectedElement] = useState<string>();
  const [status, setStatus] = useState('已保存');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [manualNotice, setManualNotice] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const dirtyKey = useId();
  const operations = useRef(new Set<Promise<void>>());
  const draft = useRef<TextEdit | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const active = useRef(true);
  const aiCancel = useRef<CancelAi | undefined>(undefined);
  const registerAiCancel = useCallback((cancel?: CancelAi) => { aiCancel.current = cancel; }, []);
  const aiBusyChanged = useCallback((busy: boolean) => { setAiBusy(busy); if (busy) setManualNotice(''); }, []);
  const manualEdit = useCallback(() => { if (aiCancel.current?.('manual')) setManualNotice('已转为手工编辑'); }, []);
  const cancelAi = useCallback(() => { aiCancel.current?.(); }, []);
  const deck = session.current;
  const slide = deck.slides.find(item => item.id === selectedId) ?? deck.slides[0];
  const element = slide?.elements.find(item => item.id === selectedElement);
  useEffect(() => {
    active.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (draft.current || pending.current) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { active.current = false; setDirty(dirtyKey, false); setDirty(`${dirtyKey}-panels`, false); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirtyKey]);
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => {
    try { if (readOnly) throw new Error('请先完成或取消当前任务'); await Promise.all([...operations.current]); await flush(); aiCancel.current?.(); }
    catch (cause) { setError(errorMessage(cause)); throw cause; }
  };
  useEffect(() => { registerLeaveGuard?.(() => leave.current()); return () => registerLeaveGuard?.(); }, [registerLeaveGuard]);
  const changed = useCallback(() => { if (active.current) refresh(value => value + 1); }, []);
  async function commit(scope: RevisionScope, mutations: DeckMutation[], summary: string) {
    if (readOnly) throw new Error('请先完成或取消重生成后再编辑');
    manualEdit(); const done = beginActivity();
    try { await session.commit(scope, mutations, summary); changed(); } finally { done(); }
  }
  async function saveText(key: string, value: string) {
    if (!slide) return;
    if (key === 'title' || key === 'message') await commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { [key]: value } }], '编辑文字');
    else {
      const item = slide.elements.find(candidate => candidate.id === key);
      if (!item || (item.type !== 'text' && item.type !== 'bullet-list')) throw new Error('文字目标已变化，请重新打开项目');
      const next: Element = item.type === 'text' ? { ...item, text: value } : { ...item, items: value.split('\n') };
      await commit({ type: 'element', slideId: slide.id, elementId: item.id }, [{ type: 'replace-element', slideId: slide.id, element: next }], '编辑文字');
    }
  }
  async function flush() {
    if (pending.current) await pending.current;
    const current = draft.current;
    if (!current) return;
    if (current.composing) throw new Error('请先完成当前输入');
    if (current.value === current.original) { draft.current = null; setDirty(dirtyKey, false); setStatus('已保存'); return; }
    setStatus('正在保存…');
    const operation = current.save();
    pending.current = operation;
    try {
      await operation;
      if (draft.current === current) draft.current = null;
      else if (draft.current?.key === current.key) draft.current.original = current.value;
      setDirty(dirtyKey, !!draft.current); setStatus(draft.current ? '未保存' : '已保存'); setError('');
    } catch (cause) { setStatus('未保存'); throw cause; }
    finally { pending.current = null; }
    if (draft.current) await flush();
  }
  async function run(action: () => void | Promise<void>) {
    const done = beginActivity();
    const operation = (async () => { try { await flush(); await action(); if (active.current) setError(''); changed(); } catch (cause) { if (active.current) setError(errorMessage(cause)); } })();
    operations.current.add(operation);
    try { await operation; } finally { operations.current.delete(operation); done(); }
  }
  async function select(id?: string) { await onSelection?.(id); setSelectedId(id); setSelectedElement(undefined); setNavigationOpen(false); }
  function source(sourceId?: string, crop = false) {
    if (!slide || !sourceId) return;
    if (!resourceAvailable) { setError('原 PDF 缺失，无法查看来源及裁图。'); return; }
    if (crop && readOnly) return;
    const selectedFigure = element?.type === 'figure' ? paper.figures.find(item => item.id === element.figureId) : undefined;
    const selectedSourceId = element?.type === 'figure' && element.panelId ? selectedFigure?.panels.find(panel => panel.id === element.panelId)?.sourceId : selectedFigure?.sourceId;
    void run(() => onSource?.(sourceId, element?.type === 'figure' && selectedSourceId === sourceId ? element : undefined, slide.id, crop, async next => {
      const current = session.current.slides.find(item => item.id === slide.id)?.elements.find(item => item.id === next.id);
      if (current?.type !== 'figure' || current.figureId !== next.figureId || current.panelId !== next.panelId) throw new Error('图源已变化，请重新打开来源后裁图');
      const cropped = { ...current }; if (next.cropOverride) cropped.cropOverride = next.cropOverride; else delete cropped.cropOverride;
      await commit({ type: 'element', slideId: slide.id, elementId: next.id }, [{ type: 'replace-element', slideId: slide.id, element: cropped }], '调整当前元素裁图');
    }, manualEdit));
  }
  async function addSlide() {
    const next = createSlide(crypto.randomUUID(), deck.slides.length + 1);
    await commit({ type: 'deck' }, [{ type: 'add-slide', slide: next, afterSlideId: slide?.id ?? null }], '新增幻灯片');
    await select(next.id);
  }
  async function move(id: string, afterSlideId: string | null) {
    if (id === afterSlideId) return;
    await commit({ type: 'deck' }, [{ type: 'move-slide', slideId: id, afterSlideId }], '调整页顺序');
  }
  async function history(direction: 'undo' | 'redo') {
    manualEdit();
    const index = slide ? session.current.slides.indexOf(slide) : 0;
    await session[direction]();
    const slides = session.current.slides;
    await select(slides.find(item => item.id === slide?.id)?.id ?? slides[Math.min(index, slides.length - 1)]?.id);
  }
  async function addElement(type: 'text' | 'bullet-list' | 'citation') {
    if (!slide) return;
    const id = crypto.randomUUID();
    const next: Element = type === 'text' ? { id, type, text: '' } : type === 'bullet-list' ? { id, type, items: [''] } : { id, type, sourceIds: slide.sourceIds.slice(0, 1) };
    await commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'add-element', slideId: slide.id, element: next }], '新增元素');
    setSelectedElement(id);
  }
  const exportPresentation = () => run(async () => {
    setExporting(true);
    try { await onExport(structuredClone(session.current)); } finally { if (active.current) setExporting(false); }
  });
  return { deck, slide, element, selectedElement, setSelectedElement, status, setStatus, error, setError, exporting, exportPresentation, aiBusy, manualNotice, manualEdit, cancelAi, aiBusyChanged, registerAiCancel, dirtyKey, draft, changed, commit, saveText, flush, run, select, source, addSlide, move, history, addElement, navigationOpen, setNavigationOpen };
}
