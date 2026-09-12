import type { Slide } from '../../modules/presentation/content';
import type { Paper } from '../../modules/paper/model';
import type { FigureResources } from '../../app/paper/figureResources';
import type { FigureGroup, FigureGroupNode } from '../../modules/presentation/layout';
import { figureArea } from '../../modules/presentation/layout/figureGeometry';
import type { BBox } from '../../shared/schema';
import { SlideCanvas } from './SlideCanvas';
import { position } from './SlidePreview';

/** The preview uses exported geometry; moving a divider keeps the draft local until pointer/key release. */
export function GroupPreview({
  slide,
  paper,
  resources,
  change,
  save,
}: {
  slide: Slide;
  paper: Paper;
  resources?: FigureResources;
  change?: (group: FigureGroup) => void;
  save?: () => void;
}) {
  const group = slide.figureGroup;
  const dividers: {
    path: ('first' | 'second')[];
    node: Extract<FigureGroupNode, { kind: 'split' }>;
    box: BBox;
    line: BBox;
  }[] = [];
  function visit(node: FigureGroupNode, box: BBox, path: ('first' | 'second')[]) {
    if (node.kind === 'image' || !group) return;
    const row = node.direction === 'row',
      gap = group.gapPt / (row ? 960 : 540);
    const size = ((row ? box.width : box.height) - gap) * node.ratio;
    dividers.push({
      path,
      node,
      box,
      line: row
        ? { x: box.x + size + gap / 2 - 0.008, y: box.y, width: 0.016, height: box.height }
        : { x: box.x, y: box.y + size + gap / 2 - 0.014, width: box.width, height: 0.028 },
    });
    visit(node.first, { ...box, ...(row ? { width: size } : { height: size }) }, [...path, 'first']);
    visit(
      node.second,
      {
        ...box,
        ...(row
          ? { x: box.x + size + gap, width: box.width - size - gap }
          : { y: box.y + size + gap, height: box.height - size - gap }),
      },
      [...path, 'second'],
    );
  }
  if (group && change) visit(group.root, figureArea(slide), []);
  function update(path: ('first' | 'second')[], ratio: number) {
    if (!group) return;
    const next = structuredClone(group);
    let node = next.root;
    for (const part of path) {
      if (node.kind !== 'split') return;
      node = node[part];
    }
    if (node.kind === 'split') node.ratio = Math.max(0.1, Math.min(0.9, ratio));
    change?.(next);
  }
  return (
    <div className="relative aspect-video w-full">
      <div className="pointer-events-none">
        <SlideCanvas slide={slide} paper={paper} resources={resources} thumbnail />
      </div>
      {dividers.map(({ path, node, box, line }) => (
        <div
          key={path.join('.') || 'root'}
          role="separator"
          tabIndex={0}
          aria-label={`图组分隔线${path.join('-') || '根'}`}
          aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
          aria-valuemin={10}
          aria-valuemax={90}
          aria-valuenow={Math.round(node.ratio * 100)}
          style={position(line)}
          className={
            'absolute z-10 touch-none bg-accent/30 outline-accent focus:bg-accent/60 ' +
            (node.direction === 'row' ? 'cursor-col-resize' : 'cursor-row-resize')
          }
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId) || !group) return;
            const bounds = e.currentTarget.parentElement!.getBoundingClientRect(),
              row = node.direction === 'row';
            const offset = row
              ? (e.clientX - bounds.left) / bounds.width - box.x
              : (e.clientY - bounds.top) / bounds.height - box.y;
            const gap = group.gapPt / (row ? 960 : 540);
            update(path, (offset - gap / 2) / ((row ? box.width : box.height) - gap));
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            save?.();
          }}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault();
              update(path, node.ratio + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -0.01 : 0.01));
            }
          }}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow')) save?.();
          }}
        />
      ))}
    </div>
  );
}
