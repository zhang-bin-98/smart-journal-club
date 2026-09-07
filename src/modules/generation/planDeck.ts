import { z } from 'zod';
import { DeckPlanSchema, type PlannedSlide } from '../outline/outline.schema';
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
function normalizedLabel(value: string, kind: 'figure' | 'panel') {
  const prefix = kind === 'figure' ? /\b(?:figure|fig)\b|图/giu : /\bpanel\b|子图/giu;
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(prefix, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
function uniqueLabelId<T extends { id: string; label?: string }>(
  value: string,
  entries: T[],
  kind: 'figure' | 'panel',
) {
  if (entries.some((entry) => entry.id === value)) return value;
  const label = normalizedLabel(value, kind);
  if (!label) return value;
  const matches = entries.filter((entry) => entry.label && normalizedLabel(entry.label, kind) === label);
  return matches.length === 1 ? matches[0].id : value;
}
function compatibleLayout(slide: PlannedSlide): PlannedSlide['layoutId'] {
  const count = slide.figures.length;
  if (count === 0) return slide.kind === 'title' ? 'title' : 'text-only';
  if (count === 1) return 'figure-text';
  if (count === 2) return 'two-figures';
  return 'panel-grid';
}
/** 仅归一化唯一 Figure/Panel 展示标签和可确定的布局容量，不猜测歧义引用或删减证据。 */
export function normalizePlanningContent(input: PlanningContent, paper: Paper): PlanningContent {
  return {
    ...input,
    slides: input.slides.map((slide) => {
      const figures = slide.figures.map((selection) => {
        const figureId = uniqueLabelId(selection.figureId, paper.figures, 'figure');
        const figure = paper.figures.find((entry) => entry.id === figureId);
        const panelId =
          selection.panelId && figure ? uniqueLabelId(selection.panelId, figure.panels, 'panel') : selection.panelId;
        return { figureId, ...(panelId ? { panelId } : {}) };
      });
      const normalized = { ...slide, figures };
      const expected = compatibleLayout(normalized);
      const count = figures.length;
      const compatible =
        (count === 0 && ['title', 'text-only'].includes(slide.layoutId)) ||
        (count === 1 && ['figure-full', 'figure-text'].includes(slide.layoutId)) ||
        (count === 2 && slide.layoutId === 'two-figures') ||
        (count >= 3 && count <= 4 && slide.layoutId === 'panel-grid');
      return compatible || count > 4 ? normalized : { ...normalized, layoutId: expected };
    }),
  };
}
/** 先验证模型临时引用，再由应用生成全部计划标识和初始版本。 */
export function assignPlanIds(input: unknown, paper: Paper) {
  const raw = normalizePlanningContent(PlanningContentSchema.parse(input), paper);
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
    try {
      return assignPlanIds(repaired, paper);
    } catch (repairCause) {
      signal.throwIfAborted();
      if (repairCause instanceof ModelOutputError) throw repairCause;
      const repairDiagnostics =
        repairCause instanceof z.ZodError
          ? repairCause.issues.map((issue) => ({
              code: issue.code,
              path: issue.path.map(String).join('.'),
              message: issue.message,
            }))
          : repairCause instanceof OutlineError
            ? [{ code: repairCause.code, path: '', message: repairCause.message }]
            : undefined;
      if (!repairDiagnostics) throw repairCause;
      throw new ModelOutputError('plan-repair', repaired, repairDiagnostics);
    }
  }
}
