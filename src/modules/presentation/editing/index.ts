import type { Deck, DeckMutation, Slide, Element } from './schema';
import { groupPreset, type FigureGroup } from '../layout';
import { figureSource } from '../../paper/sources';
import type { Paper } from '../../paper/model';
import { ContentError } from '../content';
const unique = (ids: string[]) => [...new Set(ids)];
export function layoutFor(elements: Element[]): Slide['layoutId'] {
  const count = elements.filter((e) => e.type === 'figure').length;
  const text = elements.some((e) => e.type === 'text' || e.type === 'bullet-list');
  return count > 2
    ? 'panel-grid'
    : count === 2
      ? 'two-figures'
      : count === 1
        ? text
          ? 'figure-text'
          : 'figure-full'
        : 'text-only';
}
export function splitSlide(deck: Deck, slideId: string, segmentId: string, offset?: number): DeckMutation[] {
  const slide = deck.slides.find((s) => s.id === slideId);
  const segment = deck.speech?.find((s) => s.id === segmentId);
  if (!slide || !segment || !slide.speechIds?.includes(segmentId))
    throw new ContentError('split-target', '请选择本页讲稿的换页位置。');
  const ids = [...slide.speechIds];
  const at = ids.indexOf(segmentId);
  const mutations: DeckMutation[] = [];
  let splitAt = at;
  if (offset !== undefined) {
    const id = crypto.randomUUID();
    mutations.push({ type: 'split-speech', segmentId, offset, newId: id });
    ids.splice(at + 1, 0, id);
    splitAt = at + 1;
  }
  if (!splitAt || splitAt >= ids.length) throw new ContentError('split-empty', '请选择能保留两页讲稿的换页位置。');
  const newId = crypto.randomUUID();
  const elements = slide.elements.map((element) => ({ ...structuredClone(element), id: crypto.randomUUID() }));
  const figureIds = elements.filter((e) => e.type === 'figure').map((e) => e.id);
  const mapped = new Map(slide.elements.map((element, index) => [element.id, elements[index].id]));
  const remap = (node: import('../layout').FigureGroupNode): import('../layout').FigureGroupNode =>
    node.kind === 'image'
      ? { ...node, imageId: mapped.get(node.imageId)! }
      : { ...node, first: remap(node.first), second: remap(node.second) };
  mutations.push({ type: 'update-slide', slideId, changes: { speechIds: ids.slice(0, splitAt) } });
  mutations.push({
    type: 'add-slide',
    afterSlideId: slideId,
    slide: {
      ...structuredClone(slide),
      id: newId,
      elements,
      speechIds: ids.slice(splitAt),
      figureGroup: slide.figureGroup
        ? { ...slide.figureGroup, root: remap(slide.figureGroup.root) }
        : figureIds.length
          ? groupPreset(figureIds, 'grid')
          : undefined,
    },
  });
  return mutations;
}
export function mergeSlides(deck: Deck, firstId: string, secondId: string): DeckMutation[] {
  const first = deck.slides.find((s) => s.id === firstId);
  const second = deck.slides.find((s) => s.id === secondId);
  if (!first || !second || firstId === secondId) throw new ContentError('merge-target', '请选择不同的两页。');
  const elements = structuredClone(first.elements);
  for (const element of second.elements) {
    if (
      element.type === 'figure' &&
      elements.some(
        (e) =>
          e.type === 'figure' &&
          e.figureId === element.figureId &&
          e.regionId === element.regionId &&
          e.panelId === element.panelId &&
          JSON.stringify(e.cropOverride) === JSON.stringify(element.cropOverride),
      )
    )
      continue;
    if (element.type === 'citation') {
      const existing = elements.find((e) => e.type === 'citation');
      if (existing?.type === 'citation') {
        existing.sourceIds = unique([...existing.sourceIds, ...element.sourceIds]);
        continue;
      }
    }
    elements.push(structuredClone(element));
  }
  const figures = elements.filter((e) => e.type === 'figure');
  if (figures.length > 4) throw new ContentError('merge-capacity', '合页后超过四张图，请先调整图组。');
  const merged: Slide = {
    ...first,
    elements,
    title: first.title,
    message: [...new Set([first.message, second.message].filter(Boolean))].join('\n'),
    speechIds: unique([...(first.speechIds ?? []), ...(second.speechIds ?? [])]),
    claimIds: unique([...first.claimIds, ...second.claimIds]),
    sourceIds: unique([...first.sourceIds, ...second.sourceIds]),
    layoutId: layoutFor(elements),
    figureGroup: figures.length
      ? groupPreset(
          figures.map((f) => f.id),
          'grid',
        )
      : undefined,
  };
  const index = deck.slides.indexOf(first);
  return [
    { type: 'delete-slide', slideId: secondId },
    { type: 'delete-slide', slideId: firstId },
    {
      type: 'add-slide',
      afterSlideId:
        deck.slides
          .slice(0, index)
          .filter((s) => s.id !== secondId)
          .at(-1)?.id ?? null,
      slide: merged,
    },
  ];
}
export function assignSpeech(deck: Deck, ids: string[], targetId: string): DeckMutation[] {
  if (!deck.slides.some((s) => s.id === targetId) || ids.some((id) => !deck.speech?.some((s) => s.id === id)))
    throw new ContentError('assign-target', '讲稿或目标页面不存在。');
  return deck.slides
    .filter((s) => s.id === targetId || s.speechIds?.some((id) => ids.includes(id)))
    .map((slide) => ({
      type: 'update-slide',
      slideId: slide.id,
      changes: {
        speechIds:
          slide.id === targetId
            ? unique([...(slide.speechIds ?? []), ...ids])
            : (slide.speechIds ?? []).filter((id) => !ids.includes(id)),
      },
    }));
}
export function setFigures(slide: Slide, paper: Paper, sourceIds: string[], group?: FigureGroup): DeckMutation[] {
  const figures = sourceIds.map((sourceId) => {
    const previous = slide.elements.find((e) => e.type === 'figure' && figureSource(paper, e).id === sourceId);
    if (previous?.type === 'figure') return previous;
    for (const figure of paper.figures)
      for (const region of figure.regions) {
        const panel = region.panels.find((p) => p.sourceId === sourceId);
        if (region.sourceId === sourceId || panel)
          return {
            type: 'figure' as const,
            id: crypto.randomUUID(),
            figureId: figure.id,
            regionId: region.id,
            panelId: panel?.id,
          };
      }
    throw new ContentError('missing-source', '只能选择论文已有图块。');
  });
  if (figures.length > 4 || new Set(sourceIds).size !== sourceIds.length)
    throw new ContentError('group-capacity', '图组最多四张图，不重复添加同一来源。');
  const mutations: DeckMutation[] = slide.elements
    .filter((e) => e.type === 'figure')
    .map((e) => ({ type: 'delete-element', slideId: slide.id, elementId: e.id }));
  mutations.push(...figures.map((element) => ({ type: 'add-element' as const, slideId: slide.id, element })));
  mutations.push({
    type: 'update-slide',
    slideId: slide.id,
    changes: {
      layoutId: layoutFor([...slide.elements.filter((e) => e.type !== 'figure'), ...figures]),
      sourceIds: unique([...slide.sourceIds, ...sourceIds]),
      figureGroup: figures.length
        ? (group ??
          groupPreset(
            figures.map((f) => f.id),
            'grid',
          ))
        : null,
    },
  });
  return mutations;
}

/** 页序移动保留新稿讲述归属；旧稿按邻页章节插入以维持历史连续章节约束。 */
export function moveSlideBy(deck: Deck, slideId: string, direction: -1 | 1): DeckMutation[] {
  const index = deck.slides.findIndex((slide) => slide.id === slideId);
  const slide = deck.slides[index];
  const neighbor = deck.slides[index + direction];
  if (!slide || !neighbor) throw new ContentError('move-target', '页面已在边界或不存在。');
  const targetSectionId = deck.schemaVersion === 3 ? slide.sectionId : neighbor.sectionId;
  const before = direction === 1 ? neighbor : deck.slides[index - 2];
  const anchor = deck.schemaVersion === 3 || before?.sectionId === targetSectionId ? before : undefined;
  return [{ type: 'move-slide', slideId, targetSectionId, afterSlideId: anchor?.id ?? null }];
}
