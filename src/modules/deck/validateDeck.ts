import { DeckSchema } from './deck.schema';
import type { Paper } from '../paper/paper.schema';
import { layoutCapacity } from './layoutRules';
import { figureSource, validatePaper } from '../paper/sources';

/** 只校验 Deck 结构与引用自洽（schema、ID、章节归属/连续/顺序、布局与 Paper 引用）；学术叙事规则不在其中。 */
export function validateDeck(input: unknown, paper?: Paper) {
  const parsed = DeckSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const deck = parsed.data;
  const ids = new Set<string>();
  const errors: string[] = [];
  if (paper) {
    try {
      validatePaper(paper);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (paper && deck.paperId !== paper.id) errors.push('Deck 不属于当前 Paper');
  const sectionIds = new Set<string>();
  deck.sections.forEach((section) => {
    if (ids.has(section.id)) errors.push('重复 section id');
    ids.add(section.id);
    sectionIds.add(section.id);
  });
  deck.slides.forEach((slide) => {
    if (ids.has(slide.id)) errors.push('重复 slide id');
    ids.add(slide.id);
    if (!sectionIds.has(slide.sectionId)) errors.push(`页章节不存在：${slide.id}`);
    if (!layoutCapacity(slide)) errors.push(`布局无法容纳当前元素：${slide.id}`);
    slide.elements.forEach((element) => {
      if (ids.has(element.id)) errors.push('重复 element id');
      ids.add(element.id);
      if (paper && element.type === 'figure') {
        try {
          figureSource(paper, { figureId: element.figureId, panelId: element.panelId });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        paper &&
        element.type === 'citation' &&
        element.sourceIds.some((id) => !paper.sources.some((source) => source.id === id))
      )
        errors.push(`来源不存在：${element.id}`);
    });
    if (paper && slide.sourceIds.some((id) => !paper.sources.some((source) => source.id === id)))
      errors.push(`页来源不存在：${slide.id}`);
    if (paper && slide.claimIds.some((id) => !paper.claims.some((claim) => claim.id === id)))
      errors.push(`页结论不存在：${slide.id}`);
  });
  // 同章页面必须连续，且 sections 顺序与页面块顺序一致；runtime Deck 不保留空章节。
  const blocks: string[] = [];
  let blockSectionId: string | undefined;
  for (const slide of deck.slides) {
    if (slide.sectionId !== blockSectionId) {
      if (blocks.includes(slide.sectionId)) errors.push(`章节页面不连续：${slide.sectionId}`);
      blocks.push(slide.sectionId);
      blockSectionId = slide.sectionId;
    }
  }
  if (blocks.join() !== deck.sections.map((section) => section.id).join()) errors.push('章节顺序与页面排列不一致');
  deck.sections.forEach((section) => {
    if (!blocks.includes(section.id)) errors.push(`空章节：${section.id}`);
  });
  return errors;
}
