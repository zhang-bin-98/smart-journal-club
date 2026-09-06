import { z } from 'zod';
import { DeckPlanSchema } from '../outline/outline.schema';
import type { Project } from '../project/project.schema';
import type { Paper } from '../paper/paper.schema';
import { validatePlan } from '../outline/validatePlan';
import { requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts, researchPrompt } from '../../shared/llm/prompts';
import { layoutRules } from '../deck/layoutRules';
import { ModelOutputError } from '../../shared/llm/model';
import { OutlineError } from '../outline/outlineError';

export const PlanningContentSchema = DeckPlanSchema.options[0].pick({
  title: true,
  language: true,
  sections: true,
  slides: true,
  claimEmphasis: true,
});
type PlanningContent = z.infer<typeof PlanningContentSchema>;

export const paperContext = (paper: Paper) => ({ ...paper, pages: undefined });
/** 先验证模型临时引用，再由应用生成全部计划标识和初始版本。 */
export function assignPlanIds(input: unknown, paper: Paper) {
  const raw = PlanningContentSchema.parse(input);
  const now = Date.now();
  const draft = validatePlan(
    {
      ...raw,
      schemaVersion: 2,
      id: crypto.randomUUID(),
      paperId: paper.id,
      status: 'draft',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    },
    paper,
  );
  const sectionIds = new Map(raw.sections.map((section) => [section.id, crypto.randomUUID()]));
  return validatePlan(
    {
      ...draft,
      sections: raw.sections.map((section) => ({ ...section, id: sectionIds.get(section.id)! })),
      slides: raw.slides.map((slide) => ({
        ...slide,
        id: crypto.randomUUID(),
        sectionId: sectionIds.get(slide.sectionId)!,
      })),
    },
    paper,
  );
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
  let raw: PlanningContent | undefined;
  try {
    raw = await requestJson(settings, basePrompt, context, PlanningContentSchema, signal, 'plan');
    return assignPlanIds(raw, paper);
  } catch (cause) {
    signal.throwIfAborted();
    // 仅对确定性的 schema/引用/布局失败执行一次修复，不对模型请求、取消或叙事质量问题重试。
    if (
      !(cause instanceof ModelOutputError) &&
      !(cause instanceof z.ZodError) &&
      !(cause instanceof OutlineError && cause.code === 'invalid-plan')
    )
      throw cause;
    const failedOutput = cause instanceof ModelOutputError ? cause.failedOutput : raw;
    const diagnostics =
      cause instanceof ModelOutputError
        ? cause.diagnostics
        : cause instanceof z.ZodError
          ? cause.issues.map((issue) => ({
              code: issue.code,
              path: issue.path.map(String).join('.'),
              message: issue.message,
            }))
          : [{ code: cause.code, path: '', message: cause.message }];
    const repaired = await requestJson(
      settings,
      `${basePrompt}\n\n修复约束：这是唯一一次修复请求。根据 failedOutput 和 diagnostics 只修复 schema、ID 唯一性、章节归属与连续性、Claim/Source/Figure/Panel 引用及 layoutRules 兼容性。不要改写叙事质量、背景/结果比例、讨论深度或收尾判断；保留与诊断无关的内容。返回完整规划内容，不返回应用封套。`,
      { ...context, failedOutput, diagnostics },
      PlanningContentSchema,
      signal,
      'plan-repair',
    );
    return assignPlanIds(repaired, paper);
  }
}
