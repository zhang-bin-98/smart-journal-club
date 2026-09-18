import { useState } from 'react';
import type { Paper } from '../../modules/paper/model';
import type { Element } from '../../modules/presentation/editing/schema';
import type { FigureResources } from '../../app/paper/figureResources';
import { BoxEditor, CropPreview } from '../paper/BoxEditor';
import { Button } from '../controls';
import type { BBox } from '../../shared/schema';
export function SlidesSource({
  paper,
  sourceId,
  element,
  crop,
  resources,
  onClose,
  onApply,
  onStart,
}: {
  paper: Paper;
  sourceId: string;
  element?: Extract<Element, { type: 'figure' }>;
  crop?: boolean;
  resources?: FigureResources;
  onClose: () => void;
  onApply: (bbox: BBox) => Promise<void>;
  onStart: () => void;
}) {
  const source = paper.sources.find((s) => s.id === sourceId);
  const [bbox, setBbox] = useState(element?.cropOverride ?? source?.bbox ?? { x: 0, y: 0, width: 1, height: 1 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (value: BBox) => {
    onStart();
    setBbox(value);
  };
  if (!source) return null;
  const doc = paper.documents.find((d) => d.id === source.documentId);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={crop ? '本页裁图' : '原文与图源'}
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) onClose();
      }}
    >
      <section className="flex max-h-full w-[1050px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line p-4">
          <span>
            {doc?.fileName} · 第 {source.pageNumber} 页{crop ? ' · 仅本页裁图' : ''}
          </span>
          <Button disabled={saving} onClick={onClose}>
            关闭来源
          </Button>
        </header>
        <div className="grid min-h-0 grid-cols-[1fr_280px] gap-4 overflow-auto p-4">
          <div>
            {resources && (
              <BoxEditor
                resources={resources}
                documentId={source.documentId}
                pageNumber={source.pageNumber}
                frame={{ x: 0, y: 0, width: 1, height: 1 }}
                boxes={[{ id: 'crop', bbox }]}
                selected="crop"
                disabled={!crop}
                onStart={onStart}
                onDraft={change}
                onCommit={change}
              />
            )}
          </div>
          <div className="space-y-3">
            <h3>当前图像</h3>
            {resources && source.bbox && (
              <CropPreview
                resources={resources}
                documentId={source.documentId}
                pageNumber={source.pageNumber}
                bbox={bbox}
              />
            )}
            <p className="whitespace-pre-wrap text-xs leading-relaxed">
              {source.textQuote ??
                paper.blocks
                  .filter((b) => b.documentId === source.documentId && b.pageNumber === source.pageNumber)
                  .map((b) => b.text)
                  .join('\n')}
            </p>
            {crop && (
              <>
                <p className="text-xs text-muted">拖动边框调整。保留坐标、图例和统计标注。</p>
                <Button
                  primary
                  disabled={saving}
                  onClick={() => {
                    setSaving(true);
                    setError('');
                    void onApply(bbox)
                      .catch((cause) => setError(cause.message))
                      .finally(() => setSaving(false));
                  }}
                >
                  {saving ? '正在保存裁图…' : '保存本页裁图'}
                </Button>
                <Button
                  onClick={() => {
                    onStart();
                    setBbox(source.bbox!);
                  }}
                >
                  恢复图源边界
                </Button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
