import { useEffect, useRef, useState } from 'react';
import type { Paper } from '../../modules/paper/model';
import type { FigureResources } from '../../app/paper/figureResources';
import { CropPreview } from '../paper/BoxEditor';
import { Button } from '../controls';
export function SpeechSourceCard({
  paper,
  id,
  resources,
  onSource,
}: {
  paper: Paper;
  id: string;
  resources?: FigureResources;
  onSource: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? false), {
      rootMargin: '100px',
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const source = paper.sources.find((s) => s.id === id)!;
  const figure = paper.figures.find((f) =>
    f.regions.some((r) => r.sourceId === id || r.panels.some((p) => p.sourceId === id)),
  );
  const panel = figure?.regions.flatMap((r) => r.panels).find((p) => p.sourceId === id);
  const captionIds = panel?.captionAssociation?.links.map((link) => link.sourceId) ?? figure?.captionSourceIds ?? [];
  const quotes = captionIds
    .map((sourceId) => {
      const ref = paper.sources.find((s) => s.id === sourceId);
      return (
        ref?.textQuote ??
        (ref?.textSpan &&
          paper.blocks.find((b) => b.id === ref.textSpan?.blockId)?.text.slice(ref.textSpan.start, ref.textSpan.end))
      );
    })
    .filter(Boolean);
  return (
    <div ref={host} className="min-h-32 space-y-2 rounded border border-line p-3">
      <h3 className="text-xs font-medium">
        {figure?.label ?? '图证据'} {panel?.label ?? ''}
      </h3>
      {visible && resources && source.bbox && (
        <CropPreview
          resources={resources}
          documentId={source.documentId}
          pageNumber={source.pageNumber}
          bbox={source.bbox}
        />
      )}
      <p className="whitespace-pre-wrap text-xs leading-relaxed">
        {quotes.join('\n') || figure?.caption || '暂无精确图注关联，可查看原文。'}
      </p>
      <Button onClick={() => onSource(id)}>查看原页与来源</Button>
    </div>
  );
}
