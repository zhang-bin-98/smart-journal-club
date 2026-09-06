import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { computeLayout, type Rect } from '../../layout';
import type { Element, Paper, Slide } from '../../types';
import { sourceText } from '../../sources';

export const position = (rect: Rect): CSSProperties => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
export type FigureImage = (element: Extract<Element, { type: 'figure' }>) => Promise<string>;
export type TextEdit = { key: string; value: string; original: string; composing: boolean; save: () => Promise<void> };
type Editing = { onDraft: (draft: TextEdit) => void; onBlur: () => void; onSave: (key: string, value: string) => Promise<void>; hasDraft: (key: string) => boolean };

function Editable({ value, editKey, editing, label }: { value: string; editKey: string; editing?: Editing; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    if (ref.current && !editing?.hasDraft(editKey) && ref.current.textContent !== value) ref.current.textContent = value;
  }, [value, editing, editKey]);
  const update = () => {
    const text = ref.current?.innerText ?? '';
    editing?.onDraft({ key: editKey, value: text, original: value, composing: composing.current, save: () => editing.onSave(editKey, text) });
  };
  return <div ref={ref} role={editing ? 'textbox' : undefined} aria-label={editing ? label : undefined} aria-multiline={editing ? true : undefined}
    contentEditable={!!editing} suppressContentEditableWarning spellCheck={false} data-edit-key={editKey}
    className="min-h-[1em] whitespace-pre-wrap wrap-anywhere outline-none empty:before:text-subtle focus:outline focus:outline-offset-2 focus:outline-focus"
    onInput={update} onBlur={() => { if (!composing.current) editing?.onBlur(); }}
    onCompositionStart={() => { composing.current = true; update(); }}
    onCompositionEnd={() => { composing.current = false; update(); if (document.activeElement !== ref.current) editing?.onBlur(); }}
    onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); update(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !composing.current) { if (ref.current) ref.current.textContent = value; update(); ref.current?.blur(); } }} />;
}

function Figure({ element, image }: { element: Extract<Element, { type: 'figure' }>; image: FigureImage }) {
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let active = true;
    setResult({});
    image(element).then(url => { if (active) setResult({ url }); }, () => { if (active) setResult({ error: '图源不可用' }); });
    return () => { active = false; };
  }, [image, element.figureId, element.panelId, JSON.stringify(element.cropOverride)]);
  return result.url ? <img className="block size-full object-contain" src={result.url} alt="论文图源" /> : <span className="text-xs text-muted">{result.error ?? '正在加载图源…'}</span>;
}

export const sourceLabel = sourceText;
export function SlidePreview({ slide, paper, image, selectedElement, onSelect, onSource, editing, thumbnail = false }: {
  slide: Slide; paper: Paper; image: FigureImage; selectedElement?: string; onSelect?: (id: string) => void;
  onSource?: (id: string) => void; editing?: Editing; thumbnail?: boolean;
}) {
  const layout = computeLayout(slide);
  return <div data-slide-preview={thumbnail ? 'thumbnail' : 'current'} className="relative aspect-video w-full overflow-hidden border border-control bg-white text-ink [container-type:inline-size] [&>*]:absolute">
    <div className="overflow-hidden font-bold" style={{ ...position(layout.title), fontSize: `${layout.titleText.fontSize / 9.6}cqw`, lineHeight: layout.titleText.lineHeight }}><Editable value={slide.title} editKey="title" label="幻灯片标题" editing={editing} /></div>
    {layout.message && <div className="overflow-hidden text-muted" style={{ ...position(layout.message), fontSize: `${layout.messageText.fontSize / 9.6}cqw`, lineHeight: layout.messageText.lineHeight }}><Editable value={slide.message ?? ''} editKey="message" label="幻灯片副标题" editing={editing} /></div>}
    {layout.elements.map(({ element, rect, text }) => <div key={element.id} data-element-id={element.id} onClick={() => onSelect?.(element.id)}
      className={`overflow-hidden ${selectedElement === element.id ? 'outline-2 outline-offset-2 outline-accent' : ''}`} style={{ ...position(rect), fontSize: `${text.fontSize / 9.6}cqw`, lineHeight: text.lineHeight }}>
      {element.type === 'figure' ? <button type="button" tabIndex={thumbnail ? -1 : 0} aria-label="选择 Figure" className="grid size-full grid-cols-1 grid-rows-1 cursor-pointer place-items-center bg-panel focus-visible:outline-2 focus-visible:outline-focus"><Figure element={element} image={image} /></button>
        : element.type === 'citation' ? <button type="button" tabIndex={thumbnail ? -1 : 0} className="block cursor-pointer text-left text-muted hover:underline" onClick={() => onSource?.(element.sourceIds[0])}>{sourceLabel(paper, element.sourceIds)}</button>
        : <Editable value={element.type === 'text' ? element.text : element.items.join('\n')} editKey={element.id} label={element.type === 'text' ? '幻灯片文字' : '幻灯片列表'} editing={editing} />}
    </div>)}
    <button type="button" tabIndex={thumbnail ? -1 : 0} className="overflow-hidden text-left text-[1.1cqw] leading-none whitespace-nowrap text-muted hover:underline" style={position(layout.sourceLabel)} onClick={() => onSource?.(slide.sourceIds[0])}>{sourceLabel(paper, slide.sourceIds)}</button>
  </div>;
}
