import { DeckPlanSchema, type DeckPlan } from './outline.schema';
import { DeckSchemaVersion, type Deck } from '../deck/deck.schema';
import { validateDeck } from '../deck/validateDeck';
import type { Paper } from '../paper/paper.schema';

export function validatePlan(input: unknown, paper: Paper): DeckPlan {
  const plan = DeckPlanSchema.parse(input);
  // 计划结构复用 Deck 结构校验：章节去掉预算、页面图源选择展开为 figure 元素。
  const candidate: Deck = {
    schemaVersion: DeckSchemaVersion,
    id: 'plan-validation',
    paperId: plan.paperId,
    revision: 0,
    title: plan.title,
    language: plan.language,
    sections: plan.sections.map(({ slideBudget, ...section }) => section),
    slides: plan.slides.map(({ figures, ...slide }) => ({
      ...slide,
      elements: figures.map((figure) => ({
        id: crypto.randomUUID(),
        type: 'figure' as const,
        figureId: figure.figureId,
        panelId: figure.panelId,
      })),
    })),
    createdAt: 0,
    updatedAt: 0,
  };
  const errors = validateDeck(candidate, paper);
  if (errors.length) throw new Error(`汇报计划无效：${errors.join('；')}`);
  return plan;
}
