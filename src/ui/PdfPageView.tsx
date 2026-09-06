import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { BBox } from '../types';
import { PDF_PREVIEW_EDGE, type PdfResource } from '../pdf';
import { errorMessage } from './controls';
import { position } from './editor/SlidePreview';

export function PdfPageView({ resource, pageNumber, width, height, original, selected, onBox, onDraft }: {
  resource: PdfResource; pageNumber: number; width: number; height: number; original?: BBox; selected?: BBox; onBox?: (box: BBox) => void; onDraft?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<BBox>();
  useEffect(() => {
    const controller = new AbortController(); const target = canvas.current!;
    setReady(false); setError('');
    resource.render(pageNumber, target, PDF_PREVIEW_EDGE, controller.signal).then(() => { if (!controller.signal.aborted) setReady(true); }, cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => { controller.abort(); target.width = 0; target.height = 0; };
  }, [resource, pageNumber]);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const boxAt = (event: PointerEvent<HTMLDivElement>) => {
    const end = point(event); const origin = start.current!;
    return { x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) };
  };
  const current = drag ?? selected;
  return <div className="mx-auto w-full max-w-[820px]">
    {error && <p role="alert" className="py-4 text-sm text-red-700">{error}</p>}
    <div data-pdf-page className={`relative w-full bg-white ${onBox && ready ? 'cursor-crosshair touch-none' : ''}`} style={{ aspectRatio: width / height }}
      onPointerDown={event => { if (!onBox || !ready || event.button !== 0) return; event.preventDefault(); start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (start.current) { const box = boxAt(event); if (box.width > .002 && box.height > .002) onDraft?.(); setDrag(box); } }}
      onPointerUp={event => { if (!start.current) return; const box = boxAt(event); start.current = undefined; setDrag(undefined); if (box.width > .002 && box.height > .002) onBox?.(box); }}
      onPointerCancel={() => { start.current = undefined; setDrag(undefined); }}>
      <canvas ref={canvas} className="block size-full" />
      {!ready && !error && <span className="absolute inset-0 grid place-items-center text-sm text-muted">正在加载原页…</span>}
      {ready && original && <div data-source-box className="pointer-events-none absolute border-2 border-dashed border-amber-600" style={position(original)} />}
      {ready && current && (onBox || JSON.stringify(current) !== JSON.stringify(original)) && <div data-crop-box className="pointer-events-none absolute border-2 border-accent bg-accent/5" style={position(current)} />}
    </div>
  </div>;
}
