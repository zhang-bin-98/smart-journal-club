import { DeckPlanSchema, type DeckPlan } from './outline.schema';
import type { Deck } from '../deck/deck.schema';
import { validateDeck } from '../deck/validateDeck';
import type { Paper } from '../paper/paper.schema';

export function validatePlan(input: unknown, paper: Paper): DeckPlan {
  const plan = DeckPlanSchema.parse(input);
  const candidate: Deck = { ...plan, id: 'plan-validation', revision: 0, createdAt: 0, updatedAt: 0,
    slides: plan.slides.map(({ figures, ...slide }) => ({ ...slide, elements: figures.map(figure => ({ ...figure, id: crypto.randomUUID(), type: 'figure' as const })) })),
  };
  const errors = validateDeck(candidate, paper);
  if (errors.length) throw new Error(`汇报计划无效：${errors.join('；')}`);
  return plan;
}
