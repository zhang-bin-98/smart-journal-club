import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Crop, Download, FileText, List, Plus, Quote, Redo2, Settings, Trash2, Undo2 } from 'lucide-react';
import { createSlide, DeckSession, type DeckMutation, type RevisionScope } from '../../deck';
import type { Deck, Element, Paper, Slide } from '../../types';
import { LayoutIds } from '../../types';
import { Brand, Button, errorMessage, IconButton } from '../controls';
import { SlidePreview, type FigureImage, type TextEdit } from './SlidePreview';
import { computeLayout } from '../../layout';

const layoutNames = ['标题', '文字', '单图', '图文', '双图', 'Panel 网格'];
export function Editor({ session, paper, image, name, initialSlideId, onLeave, onExport, onSelection, onSource, onSettings, notice }: {
  session: DeckSession; paper: Paper; image: FigureImage; name: string; initialSlideId?: string;
  onLeave?: () => void; onExport: (deck: Deck) => Promise<void>; onSelection?: (id?: string) => Promise<void>;
  onSettings?: () => void;
  notice?: string;
  onSource?: (sourceId: string, element: Extract<Element, { type: 'figure' }> | undefined, slideId: string, crop: boolean, apply: (element: Extract<Element, { type: 'figure' }>) => Promise<void>) => void;
}) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSlideId ?? session.current.slides[0]?.id);
  const [selectedElement, setSelectedElement] = useState<string>();
  const [status, setStatus] = useState('已保存');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const draft = useRef<TextEdit | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const active = useRef(true);
  const deck = session.current;
  const slide = deck.slides.find(item => item.id === selectedId) ?? deck.slides[0];
  const element = slide?.elements.find(item => item.id === selectedElement);
  const geometry = slide && computeLayout(slide);
  const crowded = geometry && (geometry.titleText.overflow || geometry.messageText.overflow || geometry.elements.some(item => item.text.overflow));
  useEffect(() => {
    active.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (draft.current || pending.current) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { active.current = false; window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  const changed = useCallback(() => { if (active.current) refresh(value => value + 1); }, []);
  async function commit(scope: RevisionScope, mutations: DeckMutation[], summary: string) {
    await session.commit(scope, mutations, summary);
    changed();
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
    if (current.value === current.original) { draft.current = null; setStatus('已保存'); return; }
    setStatus('正在保存…');
    const operation = current.save();
    pending.current = operation;
    try {
      await operation;
      if (draft.current === current) draft.current = null;
      else if (draft.current?.key === current.key) draft.current.original = current.value;
      setStatus(draft.current ? '未保存' : '已保存'); setError('');
    } catch (cause) { setStatus('未保存'); throw cause; }
    finally { pending.current = null; }
    if (draft.current) await flush();
  }
  async function run(action: () => void | Promise<void>) {
    try { await flush(); await action(); setError(''); changed(); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  async function select(id?: string) { await onSelection?.(id); setSelectedId(id); setSelectedElement(undefined); }
  function source(sourceId?: string, crop = false) {
    if (!slide || !sourceId) return;
    const selectedFigure = element?.type === 'figure' ? paper.figures.find(item => item.id === element.figureId) : undefined;
    const selectedSourceId = element?.type === 'figure' && element.panelId ? selectedFigure?.panels.find(panel => panel.id === element.panelId)?.sourceId : selectedFigure?.sourceId;
    void run(() => onSource?.(sourceId, element?.type === 'figure' && selectedSourceId === sourceId ? element : undefined, slide.id, crop, async next => {
      await commit({ type: 'element', slideId: slide.id, elementId: next.id }, [{ type: 'replace-element', slideId: slide.id, element: next }], '调整当前元素裁图');
    }));
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
      {onLeave && <IconButton label="返回首页" onClick={() => void run(onLeave)}><ArrowLeft size={16} /></IconButton>}
      <Brand /><h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
      <span role="status" className={`text-xs ${status === '未保存' ? 'text-red-700' : 'text-success'}`}>{status}</span>
      <Button primary disabled={!deck.slides.length || exporting} onClick={() => void run(async () => {
        setExporting(true);
        try { await onExport(structuredClone(session.current)); } finally { if (active.current) setExporting(false); }
      })}><Download size={15} />{exporting ? '正在导出…' : '导出 PPTX'}</Button>
      {onSettings && <IconButton label="模型设置" disabled={exporting} onClick={() => void run(onSettings)}><Settings size={17} /></IconButton>}
    </header>
    {notice && <p className="border-b border-line py-2 text-xs text-muted">{notice}</p>}
    {error && <div role="alert" className="flex items-center gap-3 border-b border-red-200 py-3 text-sm text-red-700"><span className="flex-1">{error}</span>{draft.current && <Button onClick={() => void run(async () => {})}>重试保存</Button>}</div>}
    <div className="mt-4 grid min-h-[680px] grid-cols-1 border border-line bg-white lg:grid-cols-[190px_minmax(0,1fr)_210px] xl:grid-cols-[210px_minmax(0,1fr)_230px]">
      <aside className="min-w-0 border-b border-line bg-panel p-3 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">幻灯片</h2><IconButton label="新增页" onClick={() => void run(addSlide)}><Plus size={16} /></IconButton></div>
        <div className="mt-3 grid max-h-[72vh] gap-2 overflow-auto lg:grid-cols-1">
          {deck.slides.map((item, index) => <div key={item.id} role="button" tabIndex={0} draggable data-slide-id={item.id} aria-label={`第 ${index + 1} 页 ${item.title}`} aria-current={item.id === slide?.id ? 'page' : undefined}
            className="cursor-pointer rounded border border-line bg-white p-2 outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-focus aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft"
            onClick={() => void run(() => select(item.id))} onKeyDown={event => { if (event.key === 'Enter') void run(() => select(item.id)); }}
            onDragStart={event => event.dataTransfer.setData('text/plain', item.id)} onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (id !== item.id) void run(() => move(id, index === 0 ? null : item.id)); }}>
            <div className="pointer-events-none"><SlidePreview thumbnail slide={item} paper={paper} image={image} /></div>
            <div className="mt-1 flex gap-2 text-xs"><span className="text-accent">{String(index + 1).padStart(2, '0')}</span><span className="truncate">{item.title || '无标题'}</span></div>
          </div>)}
        </div>
      </aside>
      <section className="min-w-0 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="truncate text-sm font-semibold">{slide?.title || '还没有幻灯片'}</h2>
          <IconButton label="删除本页" disabled={!slide} onClick={() => void run(async () => {
            if (!slide) return; const index = deck.slides.indexOf(slide);
            await commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: slide.id }], '删除幻灯片');
            await select(session.current.slides[Math.min(index, session.current.slides.length - 1)]?.id);
          })}><Trash2 size={15} /></IconButton></div>
        <div className="mt-4 grid min-h-[240px] place-items-center bg-canvas p-2 sm:min-h-[440px] sm:p-4">
          {slide ? <SlidePreview key={slide.id} slide={slide} paper={paper} image={image} selectedElement={selectedElement} onSelect={setSelectedElement} onSource={id => source(id)} editing={{
            onDraft: value => { draft.current = value; setStatus(value.value === value.original ? '已保存' : '未保存'); },
            onBlur: () => { void flush().catch(cause => setError(errorMessage(cause))); }, onSave: saveText, hasDraft: key => draft.current?.key === key,
          }} /> : <Button onClick={() => void run(addSlide)}><Plus size={16} />新增页</Button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
          {crowded && <p role="status" className="w-full text-xs text-red-700">本页文字可能溢出，请精简文字或拆页后核对导出。</p>}
          <select aria-label="选择布局" value={slide?.layoutId ?? 'text-only'} disabled={!slide} className="h-9 max-w-full rounded border border-control bg-white px-2 text-xs disabled:opacity-45" onChange={event => {
            const layoutId = event.target.value as Slide['layoutId']; if (slide) void run(() => commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { layoutId } }], '切换布局'));
          }}>{LayoutIds.map((id, index) => <option key={id} value={id}>{layoutNames[index]}</option>)}</select>
          <IconButton label="新增文字" disabled={!slide} onClick={() => void run(() => addElement('text'))}><FileText size={15} /></IconButton>
          <IconButton label="新增列表" disabled={!slide} onClick={() => void run(() => addElement('bullet-list'))}><List size={15} /></IconButton>
          <IconButton label="新增引用" disabled={!slide || !slide.sourceIds.length} onClick={() => void run(() => addElement('citation'))}><Quote size={15} /></IconButton>
          {element && <IconButton label="删除选中元素" onClick={() => void run(async () => { await commit({ type: 'slides', slideIds: [slide!.id] }, [{ type: 'delete-element', slideId: slide!.id, elementId: element.id }], '删除元素'); setSelectedElement(undefined); })}><Trash2 size={15} /></IconButton>}
          {sourceId && onSource && <><Button onClick={() => source(sourceId)}><FileText size={15} />查看来源</Button><IconButton label="裁图" onClick={() => source(sourceId, true)}><Crop size={15} /></IconButton></>}
          <div className="ml-auto flex gap-2"><IconButton label="撤销" disabled={!session.canUndo} onClick={() => void run(() => history('undo'))}><Undo2 size={16} /></IconButton><IconButton label="重做" disabled={!session.canRedo} onClick={() => void run(() => history('redo'))}><Redo2 size={16} /></IconButton></div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>第 {slide ? deck.slides.indexOf(slide) + 1 : 0} / {deck.slides.length} 页</span><div className="flex gap-2">
          <IconButton label="上移本页" disabled={!slide || deck.slides.indexOf(slide) === 0} onClick={() => void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) - 2]?.id ?? null))}><ArrowUp size={15} /></IconButton>
          <IconButton label="下移本页" disabled={!slide || deck.slides.indexOf(slide) === deck.slides.length - 1} onClick={() => void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) + 1].id))}><ArrowDown size={15} /></IconButton>
        </div></div>
      </section>
      <aside className="min-w-0 border-t border-line bg-panel p-4 lg:border-t-0 lg:border-l"><h2 className="text-sm font-semibold">{deck.title}</h2><p className="mt-3 text-xs text-muted">{deck.slides.length} 页 · {deck.language}</p><p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed wrap-anywhere text-muted">{paper.metadata.title}</p></aside>
    </div>
  </main>;
}
