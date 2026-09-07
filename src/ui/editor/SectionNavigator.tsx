import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import type { PresentationIssue } from '../../app/presentation/checkPresentation';
import { IconButton } from '../controls';
import { SlidePreview, type FigureImage } from './SlidePreview';

export function SectionNavigator({
  deck,
  paper,
  image,
  selectedSlideId,
  issues,
  readOnly,
  onAdd,
  onSelect,
  onMove,
}: {
  deck: Deck;
  paper: Paper;
  image: FigureImage;
  selectedSlideId?: string;
  issues: PresentationIssue[];
  readOnly: boolean;
  onAdd: () => void;
  onSelect: (slideId: string) => void;
  onMove: (slideId: string, afterSlideId: string | null, targetSectionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sectionId = deck.slides.find((slide) => slide.id === selectedSlideId)?.sectionId;
    if (!sectionId) return;
    setCollapsed((current) => {
      if (!current.has(sectionId)) return current;
      const next = new Set(current);
      next.delete(sectionId);
      return next;
    });
  }, [deck.slides, selectedSlideId]);
  return (
    <div className="min-w-0 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">章节与页面</h2>
        <IconButton label="新增页" disabled={readOnly} onClick={onAdd}>
          <Plus size={16} />
        </IconButton>
      </div>
      <div className="mt-3 max-h-[72vh] space-y-2 overflow-auto">
        {deck.sections.map((section) => {
          const slides = deck.slides.filter((slide) => slide.sectionId === section.id);
          const issueCount = issues.filter(
            (issue) => issue.sectionId === section.id || slides.some((slide) => slide.id === issue.slideId),
          ).length;
          const closed = collapsed.has(section.id);
          return (
            <section
              key={section.id}
              data-section-id={section.id}
              className="rounded border border-line bg-white"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (readOnly) return;
                const id = event.dataTransfer.getData('text/plain');
                if (id) onMove(id, null, section.id);
              }}
            >
              <button
                type="button"
                aria-expanded={!closed}
                aria-label={`章节 ${section.title}`}
                className="flex w-full items-center gap-2 px-2 py-2 text-left text-xs font-medium"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(section.id)) next.delete(section.id);
                    else next.add(section.id);
                    return next;
                  })
                }
              >
                {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="min-w-0 flex-1 truncate">{section.title || '未命名章节'}</span>
                <span className="text-muted">{slides.length} 页</span>
                {!!issueCount && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{issueCount}</span>
                )}
              </button>
              {!closed && (
                <div className="grid gap-2 border-t border-line p-2">
                  {slides.map((item) => {
                    const index = deck.slides.indexOf(item);
                    const itemIssues = issues.filter((issue) => issue.slideId === item.id).length;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        draggable={!readOnly}
                        data-slide-id={item.id}
                        aria-label={`第 ${index + 1} 页 ${item.title}`}
                        aria-current={item.id === selectedSlideId ? 'page' : undefined}
                        className="cursor-pointer rounded border border-line bg-white p-2 outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-focus aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft"
                        onClick={() => onSelect(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') onSelect(item.id);
                        }}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.setData('text/plain', item.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (readOnly) return;
                          const id = event.dataTransfer.getData('text/plain');
                          if (id && id !== item.id) onMove(id, item.id, section.id);
                        }}
                      >
                        <div className="pointer-events-none">
                          <SlidePreview thumbnail slide={item} paper={paper} image={image} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className="text-accent">{String(index + 1).padStart(2, '0')}</span>
                          <span className="min-w-0 flex-1 truncate">{item.title || '无标题'}</span>
                          {!!itemIssues && <span className="text-amber-700">⚠ {itemIssues}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {!deck.slides.length && <p className="py-4 text-center text-xs text-muted">还没有幻灯片</p>}
      </div>
    </div>
  );
}
