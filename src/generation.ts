import { z } from 'zod';
import { DeckSchema, SlideSchema, type Deck } from './modules/deck/deck.schema';
import { DeckPlanSchema, type DeckPlan } from './modules/outline/outline.schema';
import { ProjectSchema, type Project } from './modules/project/project.schema';
import type { Paper } from './modules/paper/paper.schema';
import { validateDeck, validatePlan } from './layout';
import { requestJson, type ModelSettings } from './model';
import { prompts, researchPrompt } from './prompts';
import { analyzeFigures, understandPaper } from './analysis';
import type { PdfResource } from './pdf';
import { captureVersion, commitRegeneration } from './modules/deck/deckRepository';
import { saveStage, type ProjectData } from './modules/project/projectRepository';

export const GENERATION_STEPS = ['解析论文', '分析 Figure / Panel', '理解研究内容', '规划汇报结构', '制作幻灯片'] as const;
export const GenerationOutputSchema = z.strictObject({ slides: z.array(SlideSchema.pick({ id: true, elements: true })).min(1) });
export const layoutRules = {
  title: '无图，最多一个副标题 text 元素', 'text-only': '无图，最多四个 text / bullet-list 元素',
  'figure-full': '一个 figure，无正文元素', 'figure-text': '一个 figure，最多两个短 text / bullet-list 元素',
  'two-figures': '两个 figure，无正文元素', 'panel-grid': '三个或四个 figure，无正文元素',
};
const paperContext = (paper: Paper) => ({ ...paper, pages: undefined });
function assignPlanIds(raw: DeckPlan, paper: Paper) {
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
export function assembleDeck(plan: DeckPlan, raw: unknown, paper: Paper): Deck {
  validatePlan(plan, paper);
  const output = GenerationOutputSchema.parse(raw);
  if (output.slides.length !== plan.slides.length || output.slides.some((slide, index) => slide.id !== plan.slides[index].id)) throw new Error('生成结果未完整遵循已保存计划，请重试制作幻灯片');
  const now = Date.now();
  const deck = DeckSchema.parse({ ...plan, id: crypto.randomUUID(), revision: 0, createdAt: now, updatedAt: now,
    slides: plan.slides.map(({ figures, ...slide }, index) => {
      const elements = output.slides[index].elements;
      const actual = elements.filter(element => element.type === 'figure');
      if (actual.length !== figures.length || actual.some((figure, i) => figure.figureId !== figures[i].figureId || figure.panelId !== figures[i].panelId || figure.cropOverride)) throw new Error('生成结果改变了计划中的图源，请重试制作幻灯片');
      return { ...slide, elements: elements.map(element => ({ ...element, id: crypto.randomUUID() })) };
    }),
  });
  const errors = validateDeck(deck, paper);
  if (errors.length) throw new Error('幻灯片未通过校验：' + errors.join('；'));
  return deck;
}
export async function generateDeck(plan: DeckPlan, paper: Paper, preferences: Project['preferences'], settings: ModelSettings, signal: AbortSignal) {
  const { strategy } = researchPrompt(preferences.strategyId);
  const raw = await requestJson(settings, [prompts.common, strategy.body, prompts.stages.generate].join('\n\n'), {
    preferences, plan, paper: paperContext(paper), layoutRules,
    textBudget: { title: 56, message: 95, figureText: 100, bulletItems: 4, bulletItem: 70 },
  }, GenerationOutputSchema, signal, 'generate');
  return assembleDeck(plan, raw, paper);
}

// 只有完整阶段进入存储；取消和刷新后由持久化检查点决定下一步。
export async function generateProject(initial: ProjectData, resource: PdfResource, settings: ModelSettings, signal: AbortSignal,
  onStage: (stage: string) => void, onSaved: (data: ProjectData) => void, onWarning: (message: string) => void) {
  let data = initial;
  while (data.project.checkpoint !== 'deck-ready') {
    signal.throwIfAborted();
    const captured = data.project;
    switch (captured.checkpoint) {
      case 'project-created': {
        onStage(GENERATION_STEPS[0]);
        const paper = await resource.parse(data.paper, signal);
        const project = await saveStage(captured, { checkpoint: 'pdf-parsed', paper }, signal);
        data = { ...data, project, paper }; break;
      }
      case 'pdf-parsed': {
        onStage(GENERATION_STEPS[1]);
        const paper = await analyzeFigures(data.paper, resource, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'figures-ready', paper }, signal);
        data = { ...data, project, paper }; break;
      }
      case 'figures-ready': {
        onStage(GENERATION_STEPS[2]);
        const result = await understandPaper(data.paper, settings, captured.preferences.instruction, signal);
        const project = await saveStage(captured, { checkpoint: 'paper-ready', ...result }, signal);
        data = { ...data, project, paper: result.paper }; break;
      }
      case 'paper-ready': {
        onStage(GENERATION_STEPS[3]);
        const { strategy, fallback } = researchPrompt(captured.preferences.strategyId);
        if (fallback) onWarning('原研究叙事策略已不可用，本次生成使用通用策略。');
        const plan = await planDeck(data.paper, { ...captured.preferences, strategyId: strategy.id }, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'deck-plan-ready', plan }, signal);
        data = { ...data, project, plan }; break;
      }
      case 'deck-plan-ready': {
        onStage(GENERATION_STEPS[4]);
        if (!data.plan) throw new Error('已保存的汇报计划缺失，请保留项目并检查本地存储');
        const { strategy, fallback } = researchPrompt(captured.preferences.strategyId);
        if (fallback) onWarning('原研究叙事策略已不可用，本次生成使用通用策略。');
        const deck = await generateDeck(data.plan, data.paper, captured.preferences, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'deck-ready', deck, strategyId: strategy.id }, signal);
        data = { ...data, project, deck, plan: undefined }; break;
      }
    }
    onSaved(data);
  }
  return data;
}

export const RegenerationPlanSchema = z.strictObject({ strategyId: z.enum(prompts.strategies.map(strategy => strategy.id) as [string, ...string[]]), plan: DeckPlanSchema });
/** 重生成只在内存重新规划和制作；复用既有 Paper，并在全部成功后一次切换版本。 */
export async function regenerateProject(initial: ProjectData, preferences: Project['preferences'], settings: ModelSettings, signal: AbortSignal,
  onStage: (stage: string) => void, onWarning: (message: string) => void = () => {}, isTaskActive?: () => boolean): Promise<ProjectData> {
  if (!initial.deck) throw new Error('当前项目尚未生成完整幻灯片。');
  const captured = captureVersion(initial.project, initial.deck);
  const paper = structuredClone(initial.paper);
  const assertActive = () => { signal.throwIfAborted(); if (isTaskActive && !isTaskActive()) throw new Error('重生成请求已失效，原有版本仍保留。'); };
  assertActive();
  const candidatePreferences = ProjectSchema.shape.preferences.parse(structuredClone(preferences));
  const { strategy, fallback } = researchPrompt(candidatePreferences.strategyId);
  if (fallback) onWarning('原研究叙事策略已不可用，本次以通用策略为默认，结合新要求重新选择。');
  candidatePreferences.strategyId = strategy.id;
  onStage(GENERATION_STEPS[3]); assertActive();
  const selected = await requestJson(settings, [prompts.common, prompts.stages.plan, '本次为整套重生成：在同一规划结果中从给定 strategies 选择一个 strategyId，并返回 plan；不要重新分析 Paper。'].join('\n\n'), {
    preferences: candidatePreferences, strategies: prompts.strategies, paper: paperContext(paper), layoutRules,
  }, RegenerationPlanSchema, signal, 'plan');
  assertActive();
  const plan = assignPlanIds(selected.plan, paper);
  candidatePreferences.strategyId = selected.strategyId;
  onStage(GENERATION_STEPS[4]); assertActive();
  const deck = await generateDeck(plan, paper, candidatePreferences, settings, signal);
  assertActive();
  const saved = await commitRegeneration(captured, deck, candidatePreferences, signal, isTaskActive);
  return { ...initial, ...saved, paper, plan: undefined };
}
