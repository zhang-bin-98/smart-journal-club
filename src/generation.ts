import { z } from 'zod';
import { DeckPlanSchema, DeckSchema, SlideSchema, type Deck, type DeckPlan, type Paper, type Project } from './types';
import { validateDeck, validatePlan } from './layout';
import { requestJson, type ModelSettings } from './model';
import { prompts, researchPrompt } from './prompts';
import { analyzeFigures, understandPaper } from './analysis';
import type { PdfResource } from './pdf';
import { saveStage, type ProjectData } from './storage';

export const GENERATION_STEPS = ['解析论文', '分析 Figure / Panel', '理解研究内容', '规划汇报结构', '制作幻灯片'] as const;
export const GenerationOutputSchema = z.strictObject({ slides: z.array(SlideSchema.pick({ id: true, elements: true })).min(1) });
export const layoutRules = {
  title: '无图，最多一个副标题 text 元素', 'text-only': '无图，最多四个 text / bullet-list 元素',
  'figure-full': '一个 figure，无正文元素', 'figure-text': '一个 figure，最多两个短 text / bullet-list 元素',
  'two-figures': '两个 figure，无正文元素', 'panel-grid': '三个或四个 figure，无正文元素',
};
const paperContext = (paper: Paper) => ({ ...paper, pages: undefined });
export async function planDeck(paper: Paper, preferences: Project['preferences'], settings: ModelSettings, signal: AbortSignal) {
  const { strategy } = researchPrompt(preferences.strategyId);
  const raw = await requestJson(settings, [prompts.common, strategy.body, prompts.stages.plan].join('\n\n'), {
    preferences, paper: paperContext(paper), layoutRules,
  }, DeckPlanSchema, signal, 'plan');
  validatePlan(raw, paper);
  return validatePlan({ ...raw, slides: raw.slides.map(slide => ({ ...slide, id: crypto.randomUUID() })) }, paper);
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
