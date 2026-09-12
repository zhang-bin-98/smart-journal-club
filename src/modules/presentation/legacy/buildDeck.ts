import { z } from 'zod';
import { DeckSchema, DeckSchemaVersion, SlideSchema, type Deck } from '../editing/schema';
import type { DeckPlan } from './outline.schema';
import type { Paper } from '../../paper/paper.schema';
import { validatePlan } from './validatePlan';
import { validateDeck } from '../editing/validateDeck';
import { validateBuiltDeckAgainstPlan } from './validateBuiltDeckAgainstPlan';
import { validatePlanNarrative } from './validateNarrative';

export function assertBuildablePlan(plan: DeckPlan, paper: Paper) {
  validatePlan(plan, paper);
  if (plan.status !== 'confirmed') throw new Error('请先确认学术大纲');
  if (validatePlanNarrative(plan, paper).errors.length) throw new Error('大纲仍有错误，请返回大纲修正');
}

export const GenerationOutputSchema = z.strictObject({
  slides: z.array(SlideSchema.pick({ id: true, elements: true })).min(1),
});
export function assembleDeck(plan: DeckPlan, raw: unknown, paper: Paper): Deck {
  assertBuildablePlan(plan, paper);
  const output = GenerationOutputSchema.parse(raw);
  if (
    output.slides.length !== plan.slides.length ||
    output.slides.some((slide, index) => slide.id !== plan.slides[index].id)
  )
    throw new Error('生成结果未完整遵循已保存计划，请重试制作幻灯片');
  const now = Date.now();
  const deck = DeckSchema.parse({
    schemaVersion: DeckSchemaVersion,
    id: crypto.randomUUID(),
    paperId: plan.paperId,
    revision: 0,
    title: plan.title,
    language: plan.language,
    sections: plan.sections.map(({ slideBudget, ...section }) => section),
    createdAt: now,
    updatedAt: now,
    slides: plan.slides.map(({ figures, ...planned }, index) => {
      const elements = output.slides[index].elements;
      const actual = elements.filter((element) => element.type === 'figure');
      if (
        actual.length !== figures.length ||
        actual.some(
          (figure, i) =>
            figure.figureId !== figures[i].figureId || figure.panelId !== figures[i].panelId || figure.cropOverride,
        )
      )
        throw new Error('生成结果改变了计划中的图源，请重试制作幻灯片');
      return {
        ...planned,
        elements: elements.map((element) => ({ ...element, id: crypto.randomUUID() })),
      };
    }),
  });
  const errors = validateDeck(deck, paper);
  if (errors.length) throw new Error(`幻灯片未通过校验：${errors.join('；')}`);
  const contractErrors = validateBuiltDeckAgainstPlan(deck, plan);
  if (contractErrors.length) throw new Error(`幻灯片未遵循确认计划：${contractErrors.join('；')}`);
  return deck;
}
