import { DeckSchema, type Deck } from '../editing/schema';
import { validateDeck } from '../editing/validateDeck';
import { type SpeechPlan, SpeechPlanSchema } from '../planning';
import type { Paper } from '../../paper/model';
import { ContentError, contentOf, validateContent, validateSpeechAssignments } from '../content';

/** Build is a pure mapping of a saved ready plan, with no planning or layout search. */
export function buildPresentation(input: SpeechPlan, paper: Paper, id: string, now: number): Deck {
  const plan = SpeechPlanSchema.parse(input);
  if (
    plan.status !== 'ready' ||
    !plan.slides.length ||
    plan.paperId !== paper.id ||
    plan.paperRevision !== paper.revision
  )
    throw new ContentError('plan-not-ready', '页面计划未就绪或论文版本已改变。');
  const content = validateContent(contentOf(plan), paper);
  validateSpeechAssignments(content, plan.slides);
  const assigned = new Set(plan.slides.flatMap((slide) => slide.speechIds));
  if (content.speech.some((segment) => !assigned.has(segment.id)))
    throw new ContentError('unassigned-plan', '页面规划遗漏了讲稿片段。');
  const deck = DeckSchema.parse({
    ...content,
    schemaVersion: 3,
    id,
    paperId: plan.paperId,
    paperRevision: plan.paperRevision,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    slides: plan.slides.map(({ figures, ...slide }) => ({
      ...slide,
      elements: [
        ...figures.map((figure) => ({ ...figure, type: 'figure' as const })),
        ...(!figures.length && slide.message
          ? [{ id: `${slide.id}-body`, type: 'text' as const, text: slide.message }]
          : []),
      ],
      message: figures.length ? slide.message : '',
    })),
  });
  for (const slide of plan.slides)
    if (slide.figures.length && !slide.figureGroup)
      throw new ContentError('missing-group', '有图计划必须保存明确图组。');
  const errors = validateDeck(deck, paper);
  if (errors.length) throw new ContentError('invalid-build', errors.join('；'));
  return deck;
}
export function assertBuiltPlan(deck: Deck, plan: SpeechPlan, paper: Paper) {
  const expected = buildPresentation(plan, paper, deck.id, deck.createdAt);
  if (JSON.stringify(expected) !== JSON.stringify(DeckSchema.parse(deck)))
    throw new ContentError('build-contract', '制作结果未严格沿用已保存计划。');
}
