import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Crop, Download, FileText, List, MoreHorizontal, Plus, Quote, RefreshCw, Redo2, Settings, Trash2, Undo2, X } from 'lucide-react';
import { createSlide, DeckSession, type DeckMutation, type RevisionScope } from '../../deck';
import type { Deck, Element, Paper, Slide } from '../../types';
import { LayoutIds } from '../../types';
import { Brand, Button, errorMessage, IconButton } from '../controls';
import { SlidePreview, type FigureImage, type TextEdit } from './SlidePreview';
import { computeLayout } from '../../layout';
import { AiPanel, type CancelAi } from './AiPanel';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../../activity';

const layoutNames = ['标题', '文字', '单图', '图文', '双图', 'Panel 网格'];
export function Editor({ session, paper, image, name, initialSlideId, onLeave, onExport, onSelection, onSource, onSettings, notice, aiSettings, aiPaper, aiProjectId, aiPreferences, readOnly = false, resourceAvailable = true, registerLeaveGuard, onRegenerate, onRestore, taskStatus, onCancelTask, externalError }: {
  session: DeckSession; paper: Paper; image: FigureImage; name: string; initialSlideId?: string;
  onLeave?: () => void; onExport: (deck: Deck) => Promise<void>; onSelection?: (id?: string) => Promise<void>;
  onSettings?: () => void;
  aiSettings?: import('../../model').ModelSettings;
  aiPaper?: Paper;
  aiProjectId?: string;
  aiPreferences?: import('../../types').Project['preferences'];
  notice?: string; readOnly?: boolean; resourceAvailable?: boolean; registerLeaveGuard?: RegisterLeaveGuard;
  onRegenerate?: () => void; onRestore?: (deck: Deck) => Promise<void>; taskStatus?: string; onCancelTask?: () => void; externalError?: string;
  onSource?: (sourceId: string, element: Extract<Element, { type: 'figure' }> | undefined, slideId: string, crop: boolean, apply: (element: Extract<Element, { type: 'figure' }>) => Promise<void>, onDraft: () => void) => void;
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
  const [aiOpen, setAiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dirtyKey = useId();
  const operations = useRef(new Set<Promise<void>>());
  const draft = useRef<TextEdit | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const active = useRef(true);
  const aiCancel = useRef<CancelAi | undefined>(undefined);
  const registerAiCancel = useCallback((cancel?: CancelAi) => { aiCancel.current = cancel; }, []);
  const aiBusyChanged = useCallback((busy: boolean) => { setAiBusy(busy); if (busy) setManualNotice(''); }, []);
  const manualEdit = useCallback(() => { if (aiCancel.current?.('manual')) setManualNotice('已转为手工编辑'); }, []);
  const deck = session.current;
  const slide = deck.slides.find(item => item.id === selectedId) ?? deck.slides[0];
  const element = slide?.elements.find(item => item.id === selectedElement);
  const geometry = slide && computeLayout(slide);
  const crowded = geometry && (geometry.titleText.overflow || geometry.messageText.overflow || geometry.elements.some(item => item.text.overflow));
  useEffect(() => {
    active.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (draft.current || pending.current) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { active.current = false; setDirty(dirtyKey, false); setDirty(dirtyKey + '-panels', false); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirtyKey]);
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => {
    try { if (readOnly) throw new Error('请先完成或取消当前任务'); await Promise.all([...operations.current]); await flush(); aiCancel.current?.(); }
    catch (cause) { setError(errorMessage(cause)); throw cause; }
  };
  useEffect(() => { registerLeaveGuard?.(() => leave.current()); return () => registerLeaveGuard?.(); }, [registerLeaveGuard]);
  useEffect(() => { setDirty(dirtyKey + '-panels', navigationOpen || aiOpen || menuOpen); }, [dirtyKey, navigationOpen, aiOpen, menuOpen]);
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
  const figure = element?.type === 'figure' ? paper.figures.find(item => item.id === element.figureId) : undefined;
  const sourceId = element?.type === 'figure' ? (element.panelId ? figure?.panels.find(panel => panel.id === element.panelId)?.sourceId : figure?.sourceId) : undefined;
  return <main className="mx-auto min-h-screen max-w-[1600px] p-3 font-sans text-ink sm:p-5">
    <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
      {onLeave && <IconButton label="返回首页" disabled={readOnly} onClick={onLeave}><ArrowLeft size={16} /></IconButton>}
      <Brand /><h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
      <span role="status" className={`text-xs ${status === '未保存' ? 'text-red-700' : 'text-success'}`}>{status}</span>
      <Button primary disabled={!deck.slides.length || exporting || (!resourceAvailable && deck.slides.some(item => item.elements.some(element => element.type === 'figure')))} onClick={() => void run(async () => {
        setExporting(true);
        try { await onExport(structuredClone(session.current)); } finally { if (active.current) setExporting(false); }
      })}><Download size={15} />{exporting ? '正在导出…' : '导出 PPTX'}</Button>
      {onSettings && <IconButton label="模型设置" disabled={exporting || aiBusy || readOnly} onClick={() => void run(onSettings)}><Settings size={17} /></IconButton>}
      {onRegenerate && <div className="relative"><IconButton label="更多操作" disabled={readOnly || aiBusy || exporting} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={17} /></IconButton>{menuOpen && <div className="absolute top-11 right-0 z-20 grid min-w-48 gap-1 rounded border border-line bg-white p-1 shadow-sm"><Button disabled={!resourceAvailable} onClick={() => void run(() => { setMenuOpen(false); onRegenerate(); })}><RefreshCw size={15} />重新生成整套 PPT</Button>{onRestore && <Button onClick={() => void run(async () => { setMenuOpen(false); aiCancel.current?.(); await onRestore(session.current); })}><Undo2 size={15} />恢复上一版</Button>}</div>}</div>}
    </header>
    {taskStatus && <div role="status" className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm"><span>{taskStatus}</span>{onCancelTask && <Button onClick={onCancelTask}><X size={15} />取消重生成</Button>}</div>}
    {externalError && <p role="alert" className="border-b border-red-200 py-3 text-sm text-red-700">{externalError}</p>}
    {!resourceAvailable && <p role="alert" className="border-b border-line py-3 text-sm text-red-700">原 PDF 缺失，来源查看、裁图及含图文稿导出不可用；已保存的文字仍可编辑。</p>}
    {manualNotice && <p role="status" className="border-b border-line py-2 text-xs text-muted">{manualNotice}</p>}
    {notice && <p className="border-b border-line py-2 text-xs text-muted">{notice}</p>}
    {error && <div role="alert" className="flex items-center gap-3 border-b border-red-200 py-3 text-sm text-red-700"><span className="flex-1">{error}</span>{draft.current && <Button onClick={() => void run(async () => {})}>重试保存</Button>}</div>}
    <div className="mt-3 flex gap-2 xl:hidden"><span className="md:hidden"><Button onClick={() => setNavigationOpen(true)}><List size={15} />幻灯片列表</Button></span>{aiSettings && <Button onClick={() => setAiOpen(true)}><Bot size={15} />AI 助手{aiBusy ? ' · 正在调整…' : ''}</Button>}</div>
    <div className="mt-4 grid min-h-[680px] grid-cols-1 border border-line bg-white md:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_300px]">
      <ResponsivePanel label="幻灯片列表" side="left" open={navigationOpen} onClose={() => setNavigationOpen(false)}>
      <div className="min-w-0 p-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">幻灯片</h2><IconButton label="新增页" disabled={readOnly} onClick={() => void run(addSlide)}><Plus size={16} /></IconButton></div>
        <div className="mt-3 grid max-h-[72vh] gap-2 overflow-auto lg:grid-cols-1">
          {deck.slides.map((item, index) => <div key={item.id} role="button" tabIndex={0} draggable={!readOnly} data-slide-id={item.id} aria-label={`第 ${index + 1} 页 ${item.title}`} aria-current={item.id === slide?.id ? 'page' : undefined}
            className="cursor-pointer rounded border border-line bg-white p-2 outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-focus aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft"
            onClick={() => void run(() => select(item.id))} onKeyDown={event => { if (event.key === 'Enter') void run(() => select(item.id)); }}
            onDragStart={event => event.dataTransfer.setData('text/plain', item.id)} onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); if (readOnly) return; const id = event.dataTransfer.getData('text/plain'); if (id !== item.id) void run(() => move(id, index === 0 ? null : item.id)); }}>
            <div className="pointer-events-none"><SlidePreview thumbnail slide={item} paper={paper} image={image} /></div>
            <div className="mt-1 flex gap-2 text-xs"><span className="text-accent">{String(index + 1).padStart(2, '0')}</span><span className="truncate">{item.title || '无标题'}</span></div>
          </div>)}
        </div>
      </div>
      </ResponsivePanel>
      <section className="min-w-0 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="truncate text-sm font-semibold">{slide?.title || '还没有幻灯片'}</h2>
          <IconButton label="删除本页" disabled={!slide || readOnly} onClick={() => void run(async () => {
            if (!slide) return; const index = deck.slides.indexOf(slide);
            await commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: slide.id }], '删除幻灯片');
            await select(session.current.slides[Math.min(index, session.current.slides.length - 1)]?.id);
          })}><Trash2 size={15} /></IconButton></div>
        <div className="mt-4 grid min-h-[240px] place-items-center bg-canvas p-2 sm:min-h-[440px] sm:p-4">
          {slide ? <SlidePreview key={slide.id} slide={slide} paper={paper} image={image} selectedElement={selectedElement} onSelect={setSelectedElement} onSource={id => source(id)} editing={readOnly ? undefined : {
            onDraft: value => { if (value.value !== value.original) manualEdit(); setDirty(dirtyKey, value.composing || value.value !== value.original); draft.current = value; setStatus(value.value === value.original ? '已保存' : '未保存'); },
            onBlur: () => { void flush().catch(cause => setError(errorMessage(cause))); }, onSave: saveText, hasDraft: key => draft.current?.key === key,
          }} /> : <Button disabled={readOnly} onClick={() => void run(addSlide)}><Plus size={16} />新增页</Button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
          {crowded && <p role="status" className="w-full text-xs text-red-700">本页文字可能溢出，请精简文字或拆页后核对导出。</p>}
          <select aria-label="选择布局" value={slide?.layoutId ?? 'text-only'} disabled={!slide || readOnly} className="h-9 max-w-full rounded border border-control bg-white px-2 text-xs disabled:opacity-45" onChange={event => {
            const layoutId = event.target.value as Slide['layoutId']; if (slide) void run(() => commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { layoutId } }], '切换布局'));
          }}>{LayoutIds.map((id, index) => <option key={id} value={id}>{layoutNames[index]}</option>)}</select>
          <IconButton label="新增文字" disabled={!slide || readOnly} onClick={() => void run(() => addElement('text'))}><FileText size={15} /></IconButton>
          <IconButton label="新增列表" disabled={!slide || readOnly} onClick={() => void run(() => addElement('bullet-list'))}><List size={15} /></IconButton>
          <IconButton label="新增引用" disabled={!slide || !slide.sourceIds.length || readOnly} onClick={() => void run(() => addElement('citation'))}><Quote size={15} /></IconButton>
          {element && <IconButton label="删除选中元素" disabled={readOnly} onClick={() => void run(async () => { await commit({ type: 'slides', slideIds: [slide!.id] }, [{ type: 'delete-element', slideId: slide!.id, elementId: element.id }], '删除元素'); setSelectedElement(undefined); })}><Trash2 size={15} /></IconButton>}
          {sourceId && onSource && <><Button disabled={!resourceAvailable} onClick={() => source(sourceId)}><FileText size={15} />查看来源</Button><IconButton label="裁图" disabled={readOnly || !resourceAvailable} onClick={() => source(sourceId, true)}><Crop size={15} /></IconButton></>}
          <div className="ml-auto flex gap-2"><IconButton label="撤销" disabled={!session.canUndo || readOnly} onClick={() => void run(() => history('undo'))}><Undo2 size={16} /></IconButton><IconButton label="重做" disabled={!session.canRedo || readOnly} onClick={() => void run(() => history('redo'))}><Redo2 size={16} /></IconButton></div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>第 {slide ? deck.slides.indexOf(slide) + 1 : 0} / {deck.slides.length} 页</span><div className="flex gap-2">
          <IconButton label="上移本页" disabled={!slide || deck.slides.indexOf(slide) === 0 || readOnly} onClick={() => void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) - 2]?.id ?? null))}><ArrowUp size={15} /></IconButton>
          <IconButton label="下移本页" disabled={!slide || deck.slides.indexOf(slide) === deck.slides.length - 1 || readOnly} onClick={() => void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) + 1].id))}><ArrowDown size={15} /></IconButton>
        </div></div>
      </section>
      {aiSettings && <ResponsivePanel label="AI 助手" side="right" open={aiOpen} onClose={() => setAiOpen(false)}><AiPanel disabled={readOnly} session={session} paper={aiPaper ?? paper} settings={aiSettings} projectId={aiProjectId} preferences={aiPreferences} selectedSlideId={slide?.id} selectedElementId={selectedElement} onChanged={changed} beforeSend={flush} beforeUndo={flush} onBusyChange={aiBusyChanged} registerCancel={registerAiCancel} /></ResponsivePanel>}
      {!aiSettings && <aside className="hidden min-w-0 border-l border-line bg-panel p-4 xl:block"><h2 className="text-sm font-semibold">{deck.title}</h2><p className="mt-3 text-xs text-muted">{deck.slides.length} 页 · {deck.language}</p><p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed wrap-anywhere text-muted">{paper.metadata.title}</p></aside>}
    </div>
  </main>;
}

function ResponsivePanel({ label, side, open, onClose, children }: { label: string; side: 'left' | 'right'; open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia(side === 'left' ? '(min-width: 768px)' : '(min-width: 1280px)');
    if (desktop.matches) { close.current(); return; }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const checkWidth = () => { if (desktop.matches) close.current(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus(); desktop.addEventListener('change', checkWidth);
    return () => { desktop.removeEventListener('change', checkWidth); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [open, side]);
  const desktopClass = side === 'left' ? 'md:static md:z-auto md:flex md:h-auto md:w-auto md:border-r md:shadow-none' : 'xl:static xl:z-auto xl:flex xl:h-[max(680px,calc(100dvh-200px))] xl:max-h-[900px] xl:w-auto xl:border-l xl:shadow-none';
  const mobileClass = side === 'left' ? 'left-0 w-[min(300px,90vw)]' : 'right-0 w-[min(380px,94vw)]';
  return <>
    {open && <button type="button" tabIndex={-1} aria-label="关闭侧栏遮罩" onClick={onClose} className={`fixed inset-0 z-40 bg-black/35 ${side === 'left' ? 'md:hidden' : 'xl:hidden'}`} />}
    <aside ref={panel} aria-label={label} role={open ? 'dialog' : undefined} aria-modal={open || undefined} tabIndex={-1}
      className={`${open ? 'fixed inset-y-0 z-50 flex h-dvh shadow-xl' : 'hidden'} ${mobileClass} min-h-0 min-w-0 flex-col border-line bg-panel outline-none ${desktopClass}`}
      onKeyDown={event => {
        if (!open) return;
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
        }
      }}>
      {open && <div className={`flex shrink-0 items-center justify-between border-b border-line px-3 py-2 ${side === 'left' ? 'md:hidden' : 'xl:hidden'}`}><span className="text-sm font-semibold">{label}</span><IconButton label={`关闭${label}`} onClick={onClose}><X size={16} /></IconButton></div>}
      {children}
    </aside>
  </>;
}
