import { useEffect, useRef, useState } from 'react';
import type { BBox } from '../../shared/schema';
import { moveBox, resizeBox, toLocalBox } from '../../modules/paper/figureGeometry';
import type { FigureResources } from '../../app/paper/figureResources';

export type BoxItem = { id: string; bbox: BBox; label?: string; candidate?: boolean };
/** Bitmap background stays stable during pointer frames; one final pointer coordinate is committed. */
export function BoxEditor({
  resources,
  documentId,
  pageNumber,
  frame,
  boxes,
  selected,
  onSelect,
  onStart,
  onDraft,
  onCommit,
  onCancel,
  adding = false,
  disabled = false,
  onDelete,
  zoom = 1,
}: {
  resources: FigureResources;
  documentId: string;
  pageNumber: number;
  frame: BBox;
  boxes: BoxItem[];
  selected?: string;
  onSelect?: (id: string) => void;
  onStart?: () => void;
  onDraft?: (bbox: BBox) => void;
  onCommit?: (bbox: BBox) => void;
  onCancel?: () => void;
  adding?: boolean;
  disabled?: boolean;
  onDelete?: () => void;
  zoom?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [ratio, setRatio] = useState(1);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const gesture = useRef<{ x: number; y: number; box: BBox; handle: string; changed: boolean } | undefined>(undefined);
  const queued = useRef<number | undefined>(undefined);
  const draft = useRef<BBox | undefined>(undefined);
  const latest = useRef(onDraft);
  latest.current = onDraft;
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    setReady(false);
    setError('');
    resources
      .acquire(documentId, pageNumber, controller.signal)
      .then((bitmap) => {
        if (controller.signal.aborted) {
          bitmap.release();
          return;
        }
        release = bitmap.release;
        const target = canvas.current!;
        const source = bitmap.canvas;
        target.width = Math.max(1, Math.round(source.width * frame.width));
        target.height = Math.max(1, Math.round(source.height * frame.height));
        target
          .getContext('2d')!
          .drawImage(
            source,
            frame.x * source.width,
            frame.y * source.height,
            frame.width * source.width,
            frame.height * source.height,
            0,
            0,
            target.width,
            target.height,
          );
        setRatio(target.width / target.height);
        setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('原图读取失败，请重新打开此图。');
      });
    return () => {
      controller.abort();
      release?.();
    };
  }, [resources, documentId, pageNumber, frame.x, frame.y, frame.width, frame.height]);
  useEffect(
    () => () => {
      if (queued.current) cancelAnimationFrame(queued.current);
    },
    [],
  );
  const point = (x: number, y: number) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: frame.x + Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * frame.width,
      y: frame.y + Math.max(0, Math.min(1, (y - rect.top) / rect.height)) * frame.height,
    };
  };
  function nextBox(clientX: number, clientY: number) {
    const start = gesture.current!;
    const p = point(clientX, clientY);
    if (start.handle === 'new')
      return {
        x: Math.min(p.x, start.x),
        y: Math.min(p.y, start.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };
    return start.handle === 'move'
      ? moveBox(start.box, p.x - start.x, p.y - start.y, frame)
      : resizeBox(start.box, start.handle, p.x - start.x, p.y - start.y, frame);
  }
  function cancel() {
    if (queued.current) cancelAnimationFrame(queued.current);
    gesture.current = undefined;
    draft.current = undefined;
    onCancel?.();
  }
  function start(event: React.PointerEvent, box?: BoxItem, handle = 'move') {
    if (disabled || !ready || event.button !== 0) return;
    if (!adding && !box) return;
    event.preventDefault();
    event.stopPropagation();
    svg.current?.focus({ preventScroll: true });
    onSelect?.(box?.id ?? '');
    const p = point(event.clientX, event.clientY);
    gesture.current = {
      ...p,
      box: box?.bbox ?? { ...p, width: 0, height: 0 },
      handle: adding ? 'new' : handle,
      changed: false,
    };
    svg.current!.setPointerCapture(event.pointerId);
  }
  return (
    <div className="overflow-auto rounded border border-line bg-white">
      {error && (
        <p role="alert" className="p-3 text-red-700">
          {error}
        </p>
      )}
      {!ready && !error && <p className="p-3 text-muted">正在读取原图…</p>}
      <div className="relative" style={{ width: `${zoom * 100}%`, aspectRatio: ratio }}>
        <canvas ref={canvas} className="absolute inset-0 block size-full" />
        <svg
          ref={svg}
          role="application"
          aria-label="图源框选画布"
          aria-busy={!ready}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: 科研裁框画布接收方向键与 Escape，手柄另有焦点。
          tabIndex={0}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full touch-none overflow-visible focus-visible:outline-2 focus-visible:outline-focus"
          onPointerDown={(event) => start(event)}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current) return;
            const bbox = nextBox(event.clientX, event.clientY);
            if (!current.changed) {
              if (
                Math.abs(bbox.x - current.box.x) +
                  Math.abs(bbox.y - current.box.y) +
                  Math.abs(bbox.width - current.box.width) +
                  Math.abs(bbox.height - current.box.height) <
                0.0002
              )
                return;
              onStart?.();
              current.changed = true;
            }
            draft.current = bbox;
            if (!queued.current)
              queued.current = requestAnimationFrame(() => {
                queued.current = undefined;
                if (draft.current) latest.current?.(draft.current);
              });
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (!current) return;
            if (queued.current) cancelAnimationFrame(queued.current);
            queued.current = undefined;
            const bbox = nextBox(event.clientX, event.clientY);
            gesture.current = undefined;
            draft.current = undefined;
            if (current.changed && bbox.width > 0.002 && bbox.height > 0.002) {
              onDraft?.(bbox);
              onCommit?.(bbox);
            } else if (current.changed) cancel();
          }}
          onPointerCancel={cancel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key === 'Delete' && selected && !disabled) {
              event.preventDefault();
              onDelete?.();
              return;
            }
            const box = boxes.find((item) => item.id === selected);
            if (!box || disabled || !event.key.startsWith('Arrow')) return;
            event.preventDefault();
            const amount = event.shiftKey ? 0.005 : 0.001;
            const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
            const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
            if (!draft.current) onStart?.();
            const handle = (event.target as Element).getAttribute('data-handle');
            draft.current = handle
              ? resizeBox(draft.current ?? box.bbox, handle, dx, dy, frame)
              : moveBox(draft.current ?? box.bbox, dx, dy, frame);
            onDraft?.(draft.current);
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') && draft.current) {
              const bbox = draft.current;
              draft.current = undefined;
              onCommit?.(bbox);
            }
          }}
        >
          <title>使用八个手柄修框，方向键微调，Esc 取消</title>
          {[...boxes]
            .sort((a, b) => Number(a.id === selected) - Number(b.id === selected))
            .map((item) => {
              const box = toLocalBox(item.bbox, frame);
              const chosen = item.id === selected;
              return (
                <g key={item.id}>
                  <rect
                    x={box.x * 1000}
                    y={box.y * 1000}
                    width={box.width * 1000}
                    height={box.height * 1000}
                    fill={chosen ? '#3b82f610' : 'transparent'}
                    stroke={item.candidate ? '#d97706' : chosen ? '#2563eb' : '#059669'}
                    strokeWidth={chosen ? 2 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={item.candidate ? '8 4' : undefined}
                    className={adding || item.candidate ? 'pointer-events-none' : 'cursor-move'}
                    onPointerDown={(event) => start(event, item)}
                  />
                  <text
                    x={box.x * 1000 + 5}
                    y={box.y * 1000 + 22}
                    fill="#1e40af"
                    fontSize="20"
                    className="pointer-events-none"
                  >
                    {item.label}
                  </text>
                  {chosen &&
                    !adding &&
                    !item.candidate &&
                    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
                      const x = box.x + (handle.includes('w') ? 0 : handle.includes('e') ? box.width : box.width / 2);
                      const y = box.y + (handle.includes('n') ? 0 : handle.includes('s') ? box.height : box.height / 2);
                      return (
                        <rect
                          key={handle}
                          role="button"
                          aria-label={`调整${handle}边界`}
                          tabIndex={0}
                          data-handle={handle}
                          x={Math.max(0, Math.min(988, x * 1000 - 6))}
                          y={Math.max(0, Math.min(988, y * 1000 - 6))}
                          width={12}
                          height={12}
                          fill="white"
                          stroke="#2563eb"
                          vectorEffect="non-scaling-stroke"
                          className="cursor-crosshair focus:outline-2 focus:outline-focus"
                          onPointerDown={(event) => start(event, item, handle)}
                        />
                      );
                    })}
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}

export function CropPreview({
  resources,
  documentId,
  pageNumber,
  bbox,
}: {
  resources: FigureResources;
  documentId: string;
  pageNumber: number;
  bbox: BBox;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    setReady(false);
    resources
      .acquire(documentId, pageNumber, controller.signal)
      .then((bitmap) => {
        if (controller.signal.aborted) {
          bitmap.release();
          return;
        }
        release = bitmap.release;
        const target = canvas.current!;
        const source = bitmap.canvas;
        target.width = Math.max(1, Math.round(source.width * bbox.width));
        target.height = Math.max(1, Math.round(source.height * bbox.height));
        target
          .getContext('2d')!
          .drawImage(
            source,
            bbox.x * source.width,
            bbox.y * source.height,
            bbox.width * source.width,
            bbox.height * source.height,
            0,
            0,
            target.width,
            target.height,
          );
        setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('原图读取失败，请重新打开此图。');
      });
    return () => {
      controller.abort();
      release?.();
    };
  }, [resources, documentId, pageNumber, bbox.x, bbox.y, bbox.width, bbox.height]);
  return (
    <div className="flex min-h-24 items-center justify-center overflow-hidden rounded border border-line bg-canvas p-2">
      {!ready && <span className="text-xs text-muted">{error || '正在裁切…'}</span>}
      <canvas
        aria-label="当前选区严格裁切预览"
        ref={canvas}
        className={`h-auto max-h-80 max-w-full object-contain ${ready ? '' : 'hidden'}`}
      />
    </div>
  );
}
