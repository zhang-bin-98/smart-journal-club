import { DeckSchema } from './deck.schema';
import type { Paper } from '../paper/paper.schema';
import { layoutCapacity } from './layoutRules';
import { figureSource, validatePaper } from '../paper/sources';

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
  deck.slides.forEach((slide) => {
    if (ids.has(slide.id)) errors.push('重复 slide id');
    ids.add(slide.id);
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
  return errors;
}
