import { z } from 'zod';
import { DeckSchema, DeckSchemaVersion, SlideSchema, type Deck } from '../deck/deck.schema';
import type { DeckPlan } from '../outline/outline.schema';
import type { Project } from '../project/project.schema';
import type { Paper } from '../paper/paper.schema';
import { validatePlan } from '../outline/validatePlan';
import { validateDeck } from '../deck/validateDeck';
import { requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts, researchPrompt } from '../../shared/llm/prompts';
import { layoutRules } from '../deck/layoutRules';
import { paperContext } from './planDeck';

export const GenerationOutputSchema = z.strictObject({
  slides: z.array(SlideSchema.pick({ id: true, elements: true })).min(1),
});
export function assembleDeck(plan: DeckPlan, raw: unknown, paper: Paper): Deck {
  validatePlan(plan, paper);
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
  return deck;
}
export async function generateDeck(
  plan: DeckPlan,
  paper: Paper,
  preferences: Project['preferences'],
  settings: ModelSettings,
  signal: AbortSignal,
) {
  const { strategy } = researchPrompt(preferences.strategyId);
  const raw = await requestJson(
    settings,
    [prompts.common, strategy.body, prompts.stages.generate].join('\n\n'),
    {
      preferences,
      plan,
      paper: paperContext(paper),
      layoutRules,
      textBudget: { title: 56, message: 95, figureText: 100, bulletItems: 4, bulletItem: 70 },
    },
    GenerationOutputSchema,
    signal,
    'generate',
  );
  return assembleDeck(plan, raw, paper);
}
