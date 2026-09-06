import { z } from 'zod';
import { DeckPlanSchema } from '../outline/outline.schema';
import { ProjectSchema, type Project } from '../project/project.schema';
import { requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts, researchPrompt } from '../../shared/llm/prompts';
import { captureVersion, commitRegeneration } from '../deck/deckRepository';
import type { ProjectData } from '../project/projectRepository';
import { GENERATION_STEPS } from './runGeneration';
import { assignPlanIds, paperContext } from './planDeck';
import { generateDeck } from './buildDeck';
import { layoutRules } from '../deck/layoutRules';

export const RegenerationPlanSchema = z.strictObject({
  strategyId: z.enum(prompts.strategies.map((strategy) => strategy.id) as [string, ...string[]]),
  plan: DeckPlanSchema,
});
/** 重生成只在内存重新规划和制作；复用既有 Paper，并在全部成功后一次切换版本。 */
export async function regenerateProject(
  initial: ProjectData,
  preferences: Project['preferences'],
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void,
  onWarning: (message: string) => void = () => {},
  isTaskActive?: () => boolean,
): Promise<ProjectData> {
  if (!initial.deck) throw new Error('当前项目尚未生成完整幻灯片。');
  const captured = captureVersion(initial.project, initial.deck);
  const paper = structuredClone(initial.paper);
  const assertActive = () => {
    signal.throwIfAborted();
    if (isTaskActive && !isTaskActive()) throw new Error('重生成请求已失效，原有版本仍保留。');
  };
  assertActive();
  const candidatePreferences = ProjectSchema.shape.preferences.parse(structuredClone(preferences));
  const { strategy, fallback } = researchPrompt(candidatePreferences.strategyId);
  if (fallback) onWarning('原研究叙事策略已不可用，本次以通用策略为默认，结合新要求重新选择。');
  candidatePreferences.strategyId = strategy.id;
  onStage(GENERATION_STEPS[3]);
  assertActive();
  const selected = await requestJson(
    settings,
    [
      prompts.common,
      prompts.stages.plan,
      '本次为整套重生成：在同一规划结果中从给定 strategies 选择一个 strategyId，并返回 plan；不要重新分析 Paper。',
    ].join('\n\n'),
    {
      preferences: candidatePreferences,
      strategies: prompts.strategies,
      paper: paperContext(paper),
      layoutRules,
    },
    RegenerationPlanSchema,
    signal,
    'plan',
  );
  assertActive();
  const plan = assignPlanIds(selected.plan, paper);
  candidatePreferences.strategyId = selected.strategyId;
  onStage(GENERATION_STEPS[4]);
  assertActive();
  const deck = await generateDeck(plan, paper, candidatePreferences, settings, signal);
  assertActive();
  const saved = await commitRegeneration(captured, deck, candidatePreferences, signal, isTaskActive);
  return { ...initial, ...saved, paper, plan: undefined };
}
