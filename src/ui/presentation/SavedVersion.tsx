import { useState, useEffect } from 'react';
import { slidesService } from '../../app/composition';
import type { FigureResources } from '../../app/paper/figureResources';
import type { SlidesWorkspace } from '../../app/presentation/slidesPorts';
import { notesText } from '../../modules/presentation/content';
import { Button } from '../controls';
import { VisibleSlide } from './SlideCanvas';
import { SlidesSource } from './SlidesSource';
export function SavedVersion({
  state,
  previous,
  onClose,
  onApply,
  onDiscard,
}: {
  state: SlidesWorkspace;
  previous: boolean;
  onClose: () => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [resources, setResources] = useState<FigureResources>();
  const [sourceId, setSourceId] = useState<string>();
  const deck = previous ? state.previous : state.candidate;
  const paper = previous ? state.previousPaper : state.candidatePaper;
  useEffect(() => {
    if (!paper) return;
    const resource = slidesService.resources({ ...state, paper });
    setResources(resource);
    return () => resource.dispose();
  }, [paper, state]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={previous ? '上一版' : '完整新稿候选'}
      className="fixed inset-0 z-30 flex flex-col bg-canvas p-6"
    >
      <header className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h2>
            {previous ? '上一版' : '完整新稿候选'} · {deck?.slides.length} 页
          </h2>
          <p className="text-xs text-muted">
            当前稿 {state.current?.slides.length ?? 0} 页 → {deck?.slides.length ?? 0} 页 · 当前讲稿{' '}
            {state.current?.speech?.length ?? 0} 段 → {deck?.speech?.length ?? 0} 段
          </p>
          {!previous && state.candidateStale && <p role="status">{state.candidateStale}</p>}
        </div>
        <div className="flex gap-2">
          <Button disabled={!previous && !!state.candidateStale} primary onClick={onApply}>
            {previous ? '恢复上一版' : '应用完整新稿'}
          </Button>
          {!previous && <Button onClick={onDiscard}>放弃完整新稿</Button>}
          <Button onClick={onClose}>返回当前稿</Button>
        </div>
      </header>
      <div className="mx-auto min-h-0 w-[900px] flex-1 space-y-6 overflow-auto py-5">
        {deck?.slides.map((slide, index) => (
          <section key={slide.id}>
            <h3 className="mb-2">
              {index + 1} · {slide.title}
            </h3>
            {paper && <VisibleSlide slide={slide} paper={paper} resources={resources} />}
            <p className="mt-3 whitespace-pre-wrap text-sm">{notesText(deck.speech ?? [], slide.speechIds ?? [])}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {slide.sourceIds.map((id) => {
                const source = paper?.sources.find((s) => s.id === id);
                const document = paper?.documents.find((d) => d.id === source?.documentId);
                return (
                  source && (
                    <Button key={id} onClick={() => setSourceId(id)}>
                      {document?.role === 'supplement' ? '补充材料' : '主论文'}第 {source.pageNumber} 页依据
                    </Button>
                  )
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {sourceId && paper && (
        <SlidesSource
          paper={paper}
          sourceId={sourceId}
          resources={resources}
          onClose={() => setSourceId(undefined)}
          onStart={() => {}}
          onApply={async () => {}}
        />
      )}
    </div>
  );
}
