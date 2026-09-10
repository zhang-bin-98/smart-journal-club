import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { FigureResources } from '../../app/paper/figureResources';
import type { FigureRef, Paper } from '../../modules/paper/model';
import type { BBox } from '../../shared/schema';
import { pageBounds } from '../../modules/paper/figureGeometry';
import { BoxEditor, type BoxItem } from './BoxEditor';
import { Button } from '../controls';

export function FigureCard({
  paper,
  figure,
  regionId,
  resources,
  selectedRegion,
  selectedPanel,
  mode,
  zoom,
  draft,
  candidate,
  disabled,
  onSelect,
  onStart,
  onDraft,
  onCommit,
  onCancel,
  onTitle,
  onVisible,
  titleEditor,
  onDelete,
}: {
  paper: Paper;
  figure: FigureRef;
  regionId: string;
  resources: FigureResources;
  selectedRegion?: string;
  selectedPanel?: string;
  mode: 'select' | 'panel' | 'region';
  zoom: number;
  draft?: { regionId: string; panelId?: string; bbox: BBox };
  candidate?: Paper;
  disabled: boolean;
  onSelect: (regionId: string, panelId?: string) => void;
  onStart: () => void;
  onDraft: (bbox: BBox) => void;
  onCommit: (bbox: BBox) => void;
  onCancel: () => void;
  onTitle: () => void;
  onVisible: () => void;
  titleEditor?: ReactNode;
  onDelete: () => void;
}) {
  const node = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries[0].isIntersecting);
        if (entries[0].isIntersecting && entries[0].intersectionRatio > 0.35) callback.current();
      },
      { rootMargin: '120px', threshold: [0, 0.4] },
    );
    if (node.current) observer.observe(node.current);
    return () => observer.disconnect();
  }, []);
  const region = figure.regions.find((item) => item.id === regionId)!;
  const source = paper.sources.find((item) => item.id === region.sourceId)!;
  const doc = paper.documents.find((item) => item.id === source.documentId)!;
  const active = selectedRegion === region.id;
  const editingRegion = active && mode === 'region';
  const boxes: BoxItem[] = editingRegion
    ? [{ id: region.id, bbox: draft?.regionId === region.id ? draft.bbox : source.bbox!, label: '整图边界' }]
    : region.panels.map((panel) => ({
        id: panel.id,
        label: panel.label || '未标号',
        bbox:
          draft?.regionId === region.id && draft.panelId === panel.id
            ? draft.bbox
            : paper.sources.find((item) => item.id === panel.sourceId)!.bbox!,
      }));
  if (mode === 'panel' && active && draft) boxes.push({ id: 'new', bbox: draft.bbox, label: '新 Panel' });
  const candidateRegion = candidate?.figures.flatMap((item) => item.regions).find((item) => item.id === region.id);
  if (candidateRegion && candidate)
    for (const panel of candidateRegion.panels)
      boxes.push({
        id: `candidate:${panel.id}`,
        label: panel.label,
        bbox: candidate.sources.find((item) => item.id === panel.sourceId)!.bbox!,
        candidate: true,
      });
  return (
    <article
      ref={node}
      id={`region-${region.id}`}
      data-region={region.id}
      className={`mb-5 scroll-mt-3 rounded border bg-white p-4 ${active ? 'border-accent' : 'border-line'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        {titleEditor ?? (
          <button
            className="cursor-pointer rounded px-1 text-left text-base font-semibold hover:bg-panel focus-visible:outline-2 focus-visible:outline-focus"
            onClick={onTitle}
          >
            {figure.label || '未标号 Figure'}
          </button>
        )}
        <Button onClick={() => onSelect(region.id)}>{region.panels.length ? '选中整图' : '整图可直接使用'}</Button>
      </div>
      <p className="mb-3 break-words text-xs text-muted">
        {doc.role === 'primary' ? '主论文' : '补充材料'} · {doc.fileName} · 第 {source.pageNumber} 页 · 图块{' '}
        {figure.regions.findIndex((item) => item.id === region.id) + 1}
      </p>
      {visible ? (
        <BoxEditor
          resources={resources}
          documentId={source.documentId}
          pageNumber={source.pageNumber}
          frame={editingRegion ? pageBounds : source.bbox!}
          boxes={boxes}
          selected={active ? (editingRegion ? region.id : selectedPanel) : undefined}
          adding={active && mode === 'panel'}
          zoom={active ? zoom : 1}
          disabled={disabled || !active}
          onSelect={(panelId) => onSelect(region.id, editingRegion ? undefined : panelId)}
          onStart={onStart}
          onDraft={onDraft}
          onCommit={onCommit}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      ) : (
        <div className="flex h-80 items-center justify-center bg-canvas text-xs text-muted">滚动到此图加载原始图像</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {region.panels.map((panel) => (
          <button
            key={panel.id}
            className={`rounded border px-2 py-1 text-xs ${active && selectedPanel === panel.id ? 'border-accent bg-accent/10' : 'border-line'}`}
            onClick={() => onSelect(region.id, panel.id)}
          >
            {panel.label || '未标号 Panel'}
          </button>
        ))}
      </div>
    </article>
  );
}
