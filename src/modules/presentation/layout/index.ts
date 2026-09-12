import type { BBox } from '../../../shared/schema';
import { FigureGroupSchema, type FigureGroup, type FigureGroupNode } from '../content/page';
export { FigureGroupSchema, FigureGroupNodeSchema } from '../content/page';
export type { FigureGroup, FigureGroupNode } from '../content/page';
export const groupLeaves = (node: FigureGroupNode): string[] =>
  node.kind === 'image' ? [node.imageId] : [...groupLeaves(node.first), ...groupLeaves(node.second)];

/** Gap uses the same 960 × 540 point page in preview and PPTX. */
export function groupRects(group: FigureGroup, area: BBox): Record<string, BBox> {
  const output: Record<string, BBox> = {};
  function visit(node: FigureGroupNode, box: BBox, depth: number) {
    if (depth > 3 || box.width <= 0 || box.height <= 0) throw new Error('图组分区无法容纳当前图像。');
    if (node.kind === 'image') {
      if (output[node.imageId]) throw new Error('图组重复引用图像。');
      output[node.imageId] = box;
      return;
    }
    const horizontal = node.direction === 'row';
    const length = horizontal ? box.width : box.height;
    const gap = group.gapPt / (horizontal ? 960 : 540);
    const first = (length - gap) * node.ratio;
    visit(node.first, { ...box, ...(horizontal ? { width: first } : { height: first }) }, depth + 1);
    visit(
      node.second,
      {
        ...box,
        ...(horizontal
          ? { x: box.x + first + gap, width: length - first - gap }
          : { y: box.y + first + gap, height: length - first - gap }),
      },
      depth + 1,
    );
  }
  visit(FigureGroupSchema.parse(group).root, area, 0);
  return output;
}
export function containRect(area: BBox, aspect: number): BBox {
  const width = Math.min(area.width, ((area.height * 540) / 960) * aspect);
  const height = (width * 960) / 540 / aspect;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}
export type GroupPreset = 'row' | 'column' | 'grid' | 'left-pair' | 'top-pair';
export function groupPreset(ids: string[], preset: GroupPreset, ratio = 0.5, gapPt = 12): FigureGroup {
  if (!ids.length || ids.length > 4) throw new Error('每页图组支持一至四张图。');
  const leaf = (id: string): FigureGroupNode => ({ kind: 'image', imageId: id });
  const split = (
    direction: 'row' | 'column',
    first: FigureGroupNode,
    second: FigureGroupNode,
    value = ratio,
  ): FigureGroupNode => ({ kind: 'split', direction, ratio: value, first, second });
  const chain = (items: string[], direction: 'row' | 'column'): FigureGroupNode =>
    items.length === 1
      ? leaf(items[0])
      : split(direction, leaf(items[0]), chain(items.slice(1), direction), 1 / items.length);
  let root: FigureGroupNode;
  if (ids.length === 1) root = leaf(ids[0]);
  else if (ids.length === 2) root = split(preset === 'column' ? 'column' : 'row', leaf(ids[0]), leaf(ids[1]));
  else if (preset === 'row' || preset === 'column') root = chain(ids, preset);
  else if (preset === 'top-pair') root = split('column', chain(ids.slice(0, 2), 'row'), chain(ids.slice(2), 'row'));
  else root = split('row', chain(ids.slice(0, 2), 'column'), chain(ids.slice(2), 'column'));
  return FigureGroupSchema.parse({ root, gapPt });
}

/** Finite deterministic candidates preserve the supplied reading order and every image. */
export function rankGroups(images: { id: string; aspect: number }[], area: BBox) {
  const candidates: { group: FigureGroup; score: number; preset: GroupPreset }[] = [];
  for (const preset of ['row', 'column', 'grid', 'left-pair', 'top-pair'] as GroupPreset[]) {
    for (const ratio of [0.35, 0.5, 0.65]) {
      const group = groupPreset(
        images.map((image) => image.id),
        preset,
        ratio,
      );
      try {
        const boxes = groupRects(group, area);
        const sizes = images.map((image) => containRect(boxes[image.id], image.aspect));
        const areas = sizes.map((box) => box.width * box.height);
        const score = Math.min(...areas) * 4 + areas.reduce((a, b) => a + b, 0);
        candidates.push({ group, score, preset });
      } catch {
        /* Reject impossible partitions before scoring. */
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function pruneGroup(group: FigureGroup, ids: string[]): FigureGroup | undefined {
  function prune(node: FigureGroupNode): FigureGroupNode | undefined {
    if (node.kind === 'image') return ids.includes(node.imageId) ? node : undefined;
    const first = prune(node.first);
    const second = prune(node.second);
    return first && second ? { ...node, first, second } : (first ?? second);
  }
  const root = prune(group.root);
  return root ? { ...group, root } : undefined;
}
