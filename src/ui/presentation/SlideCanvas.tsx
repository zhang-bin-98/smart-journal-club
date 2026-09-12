import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Deck, Slide, Element } from '../../modules/presentation/editing/schema';
import type { Paper } from '../../modules/paper/model';
import type { FigureResources } from '../../app/paper/figureResources';
import { computeLayout } from '../../modules/presentation/layout/computeLayout';
import { imageAspect } from '../../modules/presentation/layout/figureGeometry';
import { figureSource, sourceText, sourceIdsExcludingPages } from '../../modules/paper/sources';
import { Editable, position, type Editing } from './SlidePreview';
function FigureCanvas({
  paper,
  element,
  resources,
}: {
  paper: Paper;
  element: Extract<Element, { type: 'figure' }>;
  resources?: FigureResources;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const source = figureSource(paper, element);
  const documentId = 'documentId' in source ? (source.documentId as string) : '';
  const bbox = element.cropOverride ?? source.bbox!;
  useEffect(() => {
    if (!resources) return;
    const controller = new AbortController();
    setError('');
    resources
      .acquire(documentId, source.pageNumber, controller.signal)
      .then((bitmap) => {
        try {
          if (controller.signal.aborted || !ref.current) return;
          const canvas = ref.current;
          canvas.width = Math.max(1, Math.round(bitmap.canvas.width * bbox.width));
          canvas.height = Math.max(1, Math.round(bitmap.canvas.height * bbox.height));
          canvas
            .getContext('2d')!
            .drawImage(
              bitmap.canvas,
              bbox.x * bitmap.canvas.width,
              bbox.y * bitmap.canvas.height,
              bbox.width * bitmap.canvas.width,
              bbox.height * bitmap.canvas.height,
              0,
              0,
              canvas.width,
              canvas.height,
            );
        } finally {
          bitmap.release();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('图源不可用');
      });
    return () => controller.abort();
  }, [resources, documentId, source.pageNumber, bbox.x, bbox.y, bbox.width, bbox.height]);
  return error ? <span>{error}</span> : <canvas ref={ref} className="block size-full" aria-label="论文原图裁切" />;
}
export const SlideCanvas = memo(function SlideCanvas({
  slide,
  paper,
  resources,
  editing,
  onSelect,
  onSource,
  selectedElement,
  thumbnail = false,
}: {
  slide: Slide;
  paper: Paper;
  resources?: FigureResources;
  editing?: Editing;
  onSelect?: (id: string) => void;
  onSource?: (id: string) => void;
  selectedElement?: string;
  thumbnail?: boolean;
}) {
  const layout = useMemo(
    () =>
      computeLayout(
        slide,
        Object.fromEntries(slide.elements.filter((e) => e.type === 'figure').map((e) => [e.id, imageAspect(paper, e)])),
      ),
    [slide, paper],
  );
  const citationIds = slide.elements.flatMap((e) => (e.type === 'citation' ? e.sourceIds : []));
  const footerIds = sourceIdsExcludingPages(paper, slide.sourceIds, citationIds);
  return (
    <div
      data-slide-preview={thumbnail ? 'thumbnail' : 'current'}
      className="relative aspect-video w-full overflow-hidden border border-control bg-white text-ink shadow-sm [container-type:inline-size] [&>*]:absolute"
    >
      <div
        style={{
          ...position(layout.title),
          fontSize: `${layout.titleText.fontSize / 9.6}cqw`,
          lineHeight: layout.titleText.lineHeight,
        }}
        className="overflow-hidden font-bold"
      >
        <Editable value={slide.title} editKey="title" label="幻灯片标题" editing={editing} />
      </div>
      {layout.message && (
        <div
          className="overflow-hidden text-muted"
          style={{ ...position(layout.message), fontSize: `${layout.messageText.fontSize / 9.6}cqw` }}
        >
          <Editable value={slide.message ?? ''} editKey="message" label="幻灯片说明" editing={editing} />
        </div>
      )}
      {layout.elements.map(({ element, rect, text }) => (
        <div
          key={element.id}
          data-element-id={element.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(element.id);
          }}
          className={`overflow-hidden ${selectedElement === element.id ? 'outline-2 outline-offset-2 outline-accent' : ''}`}
          style={{ ...position(rect), fontSize: `${text.fontSize / 9.6}cqw`, lineHeight: text.lineHeight }}
        >
          {element.type === 'figure' ? (
            <button tabIndex={thumbnail ? -1 : 0} className="block size-full" aria-label="选择 Figure">
              <FigureCanvas paper={paper} element={element} resources={resources} />
            </button>
          ) : element.type === 'citation' ? (
            <button onClick={() => onSource?.(element.sourceIds[0])}>{sourceText(paper, element.sourceIds)}</button>
          ) : (
            <Editable
              value={element.type === 'text' ? element.text : element.items.join('\n')}
              editKey={element.id}
              label="幻灯片文字"
              editing={editing}
            />
          )}
        </div>
      ))}
      <button
        tabIndex={thumbnail ? -1 : 0}
        className="overflow-hidden whitespace-nowrap text-left text-[1.1cqw] text-muted"
        style={position(layout.sourceLabel)}
        onClick={() => onSource?.(footerIds[0])}
      >
        {sourceText(paper, footerIds)}
      </button>
    </div>
  );
});
export function VisibleSlide({
  slide,
  paper,
  resources,
  children,
}: {
  slide: Slide;
  paper: Paper;
  resources?: FigureResources;
  children?: (visible: boolean) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? false), {
      rootMargin: '120px',
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="aspect-video w-full">
      {children ? (
        children(visible)
      ) : visible ? (
        <SlideCanvas slide={slide} paper={paper} resources={resources} thumbnail />
      ) : (
        <div className="grid aspect-video place-items-center border border-line bg-white p-2 text-xs text-muted">
          {slide.title}
        </div>
      )}
    </div>
  );
}
export function slideTextMutation(deck: Deck, slideId: string, key: string, value: string) {
  const slide = deck.slides.find((s) => s.id === slideId)!;
  if (key === 'title' || key === 'message')
    return { type: 'update-slide' as const, slideId, changes: { [key]: value } };
  const element = slide.elements.find((e) => e.id === key);
  if (!element || (element.type !== 'text' && element.type !== 'bullet-list')) throw new Error('文字元素不存在。');
  return {
    type: 'replace-element' as const,
    slideId,
    element: element.type === 'text' ? { ...element, text: value } : { ...element, items: value.split('\n') },
  };
}
