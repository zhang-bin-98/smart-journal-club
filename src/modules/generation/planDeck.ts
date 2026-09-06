import { DeckPlanSchema, type DeckPlan } from '../outline/outline.schema';
import type { Project } from '../project/project.schema';
import type { Paper } from '../paper/paper.schema';
import { validatePlan } from '../../layout';
import { requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts, researchPrompt } from '../../prompts';
import { layoutRules } from '../deck/layoutRules';

export const paperContext = (paper: Paper) => ({ ...paper, pages: undefined });
export function assignPlanIds(raw: DeckPlan, paper: Paper) {
  validatePlan(raw, paper);
  return validatePlan({ ...raw, slides: raw.slides.map(slide => ({ ...slide, id: crypto.randomUUID() })) }, paper);
}
export async function planDeck(paper: Paper, preferences: Project['preferences'], settings: ModelSettings, signal: AbortSignal) {
  const { strategy } = researchPrompt(preferences.strategyId);
  const raw = await requestJson(settings, [prompts.common, strategy.body, prompts.stages.plan].join('\n\n'), {
    preferences, paper: paperContext(paper), layoutRules,
  }, DeckPlanSchema, signal, 'plan');
  return assignPlanIds(raw, paper);
}
