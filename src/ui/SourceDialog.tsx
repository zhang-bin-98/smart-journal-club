import { useEffect, useRef, useState } from 'react';
import { Crop, RotateCcw, X } from 'lucide-react';
import type { BBox, Element, Paper } from '../types';
import type { PdfResource } from '../pdf';
import { Button, errorMessage, IconButton } from './controls';
import { PdfPageView } from './PdfPageView';
import { beginActivity } from '../activity';

export type SourceSelection = { onDraft?: () => void; sourceId: string; element?: Extract<Element, { type: 'figure' }>; crop: boolean; apply?: (element: Extract<Element, { type: 'figure' }>) => Promise<void> };
export function SourceDialog({ paper, resource, selection, onClose, readOnly = false }: { readOnly?: boolean; paper: Paper; resource?: PdfResource; selection: SourceSelection; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const source = paper.sources.find(item => item.id === selection.sourceId);
  const page = paper.pages.find(item => item.pageNumber === source?.pageNumber);
  const [cropping, setCropping] = useState(selection.crop);
  const [box, setBox] = useState<BBox | undefined>(selection.element?.cropOverride ?? source?.bbox);
  const [useDefault, setUseDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const figure = paper.figures.find(item => item.sourceId === source?.id || item.panels.some(panel => panel.sourceId === source?.id));
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} aria-label="论文来源" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
    className="fixed inset-0 m-auto max-h-[94dvh] w-[min(960px,96vw)] max-w-none overflow-hidden rounded-md border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-black/35">
    <div className="flex max-h-[94dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3"><h2 className="text-sm font-semibold">{figure?.label ?? '论文来源'} · 论文第 {source?.pageNumber ?? '?'} 页</h2><IconButton label="关闭来源" disabled={saving} onClick={onClose}><X size={16} /></IconButton></header>
      <div className="min-h-0 overflow-auto bg-canvas p-3 sm:p-5">
        {!resource || !source || !page ? <p role="alert" className="py-6 text-sm text-red-700">原 PDF 或来源缺失，无法查看及裁图。</p> : <PdfPageView resource={resource} pageNumber={page.pageNumber} width={page.width} height={page.height} original={source.bbox} selected={box} onDraft={selection.onDraft} onBox={cropping && !saving && !readOnly ? next => { if (JSON.stringify(next) !== JSON.stringify(box)) selection.onDraft?.(); setBox(next); setUseDefault(false); } : undefined} />}
      </div>
      <footer className="shrink-0 border-t border-line px-5 py-3">
        <p className="max-h-24 overflow-auto text-xs leading-relaxed wrap-anywhere text-muted">{figure?.caption ?? source?.textQuote}</p>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {cropping && !readOnly ? <><Button disabled={saving} onClick={() => { if (JSON.stringify(box) !== JSON.stringify(source?.bbox) || selection.element?.cropOverride) selection.onDraft?.(); setBox(source?.bbox); setUseDefault(true); }}><RotateCcw size={15} />恢复默认范围</Button><Button disabled={saving} onClick={onClose}>取消</Button><Button primary disabled={!box || !resource || !selection.element || saving} onClick={async () => {
            if (!selection.element || !box || readOnly) return; const done = beginActivity(); setSaving(true); setError('');
            const next = { ...selection.element }; if (useDefault) delete next.cropOverride; else next.cropOverride = box;
            try { await selection.apply?.(next); onClose(); } catch (cause) { setError(errorMessage(cause)); } finally { setSaving(false); done(); }
          }}>{saving ? '正在保存…' : '应用到本页'}</Button></> : selection.element && !readOnly && <Button disabled={!resource} onClick={() => setCropping(true)}><Crop size={15} />调整裁图</Button>}
        </div>
      </footer>
    </div>
  </dialog>;
}
