import { useEffect, useRef, useState } from 'react';
import type { BBox } from '../../shared/schema';
import type { AnalysisSession } from '../../app/paper/analysisService';
import { Button } from '../controls';

const PREVIEW_CACHE_BYTES = 32 * 1024 * 1024;
const previews = new Map<string, { src: string; bytes: number }>();
let previewBytes = 0;
function cachePreview(key: string, src: string) {
  const bytes = src.length * 2;
  const prior = previews.get(key);
  if (prior) {
    previewBytes -= prior.bytes;
    previews.delete(key);
  }
  if (bytes > PREVIEW_CACHE_BYTES) return;
  previews.set(key, { src, bytes });
  previewBytes += bytes;
  while (previews.size > 12 || previewBytes > PREVIEW_CACHE_BYTES) {
    const oldest = previews.keys().next().value!;
    previewBytes -= previews.get(oldest)!.bytes;
    previews.delete(oldest);
  }
}
export function PagePreview({
  session,
  documentId,
  pageNumber,
  thumbnail = false,
  regions = [],
}: {
  session: AnalysisSession;
  documentId: string;
  pageNumber: number;
  thumbnail?: boolean;
  regions?: { id: string; label: string; bbox: BBox; panel: boolean }[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!thumbnail || !container.current) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? false), {
      rootMargin: '100px',
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 重试按钮重新请求当前文件原页。
  useEffect(() => {
    setFailed(false);
    setSrc(undefined);
    if (!visible) return;
    const key = `${documentId}:${pageNumber}`;
    const cached = previews.get(key);
    if (cached) {
      setSrc(cached.src);
      return;
    }
    const controller = new AbortController();
    session
      .preview(documentId, pageNumber, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        cachePreview(key, value);
        setSrc(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [session, documentId, pageNumber, visible, retry]);
  return (
    <div
      ref={container}
      className={`flex items-center justify-center overflow-hidden bg-canvas ${thumbnail ? 'aspect-[0.72]' : 'min-h-52'}`}
    >
      {src ? (
        <div className="relative w-full">
          <img src={src} alt={`原文件第 ${pageNumber} 页`} className="block h-auto max-h-full w-full object-contain" />
          {regions.map((region) => (
            <div
              key={region.id}
              className={`pointer-events-none absolute border-2 ${region.panel ? 'border-dashed border-amber-600' : 'border-accent'}`}
              style={{
                left: `${region.bbox.x * 100}%`,
                top: `${region.bbox.y * 100}%`,
                width: `${region.bbox.width * 100}%`,
                height: `${region.bbox.height * 100}%`,
              }}
            >
              <span className="absolute left-0 top-0 bg-white/90 px-1 text-[10px] text-ink">{region.label}</span>
            </div>
          ))}
        </div>
      ) : failed ? (
        <div className="p-3 text-center text-xs text-muted">
          <p>预览未读取</p>
          {!thumbnail && (
            <Button className="mt-2" onClick={() => setRetry((value) => value + 1)}>
              重试预览
            </Button>
          )}
        </div>
      ) : (
        <p className="p-3 text-xs text-muted">{visible ? '正在读取原页…' : `第 ${pageNumber} 页`}</p>
      )}
    </div>
  );
}

export function WorkspaceDivider({
  label,
  width,
  min,
  max,
  reverse = false,
  onChange,
}: {
  label: string;
  width: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | undefined>(undefined);
  function resize(value: number) {
    onChange(Math.max(min, Math.min(max, value)));
  }
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize bg-line/70 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current) resize(start.current.width + (event.clientX - start.current.x) * (reverse ? -1 : 1));
      }}
      onPointerUp={() => {
        start.current = undefined;
      }}
      onPointerCancel={() => {
        start.current = undefined;
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          resize(width + (event.key === 'ArrowLeft' ? -16 : 16) * (reverse ? -1 : 1));
        }
      }}
    />
  );
}
