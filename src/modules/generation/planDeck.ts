import { DeckPlanSchema, type DeckPlan } from '../outline/outline.schema';
import type { Project } from '../project/project.schema';
import type { Paper } from '../paper/paper.schema';
import { validatePlan } from '../outline/validatePlan';
import { requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts, researchPrompt } from '../../shared/llm/prompts';
import { layoutRules } from '../deck/layoutRules';
import { ModelError } from '../../shared/llm/model';

export const paperContext = (paper: Paper) => ({ ...paper, pages: undefined });
export function assignPlanIds(raw: DeckPlan, paper: Paper) {
  validatePlan(raw, paper);
  return validatePlan({ ...raw, slides: raw.slides.map((slide) => ({ ...slide, id: crypto.randomUUID() })) }, paper);
}
export async function planDeck(
  paper: Paper,
  preferences: Project['preferences'],
  settings: ModelSettings,
  signal: AbortSignal,
) {
  const { strategy } = researchPrompt(preferences.strategyId);
  const context = { preferences, paper: paperContext(paper), layoutRules };
  const basePrompt = [prompts.common, strategy.body, prompts.stages.plan].join('\n\n');
  try {
    const raw = await requestJson(settings, basePrompt, context, DeckPlanSchema, signal, 'plan');
    return assignPlanIds(raw, paper);
  } catch (cause) {
    signal.throwIfAborted();
    // 仅对确定性的 schema/引用/布局失败执行一次修复，不对模型请求、取消或叙事质量问题重试。
    const repairable =
      (cause instanceof ModelError && cause.code === 'invalid-output') ||
      (!(cause instanceof ModelError) && cause instanceof Error);
    if (!repairable) throw cause;
    const repaired = await requestJson(
      settings,
      `${basePrompt}\n\n修复约束：这是唯一一次修复请求。只修复 DeckPlan v2 的 schema、ID 唯一性、章节归属与连续性、Claim/Source/Figure/Panel 引用及 layoutRules 兼容性。不要改写叙事质量、背景/结果比例、讨论深度或收尾判断。返回完整 DeckPlan。`,
      context,
      DeckPlanSchema,
      signal,
      'plan-repair',
    );
    return assignPlanIds(repaired, paper);
  }
}
