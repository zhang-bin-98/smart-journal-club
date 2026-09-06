import { researchPrompt } from '../../shared/llm/prompts';
import type { ModelSettings } from '../../shared/llm/model';
import { analyzeFigures, understandPaper } from '../paper/analysis';
import { parsePaper } from '../paper/parsePaper';
import type { PdfResource } from '../../shared/pdf/pdfResource';
import { saveStage, type ProjectData } from '../project/projectRepository';
import { planDeck } from './planDeck';
import { generateDeck } from './buildDeck';

export const GENERATION_STEPS = [
  '解析论文',
  '分析 Figure / Panel',
  '理解研究内容',
  '规划汇报结构',
  '制作幻灯片',
] as const;

export async function preparePaper(
  initial: ProjectData,
  resource: PdfResource,
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void = () => {},
): Promise<ProjectData> {
  let data = initial;
  const captured = data.project;
  if (captured.checkpoint === 'project-created') {
    onStage(GENERATION_STEPS[0]);
    const paper = await parsePaper(resource, data.paper, signal);
    const project = await saveStage(captured, { checkpoint: 'pdf-parsed', paper }, signal);
    data = { ...data, project, paper };
  }
  if (data.project.checkpoint === 'pdf-parsed') {
    onStage(GENERATION_STEPS[1]);
    const paper = await analyzeFigures(data.paper, resource, settings, signal);
    const project = await saveStage(data.project, { checkpoint: 'figures-ready', paper }, signal);
    data = { ...data, project, paper };
  }
  if (data.project.checkpoint === 'figures-ready') {
    onStage(GENERATION_STEPS[2]);
    const result = await understandPaper(data.paper, settings, data.project.preferences.instruction, signal);
    const project = await saveStage(data.project, { checkpoint: 'paper-ready', ...result }, signal);
    data = { ...data, project, paper: result.paper };
  }
  return data;
}

export async function prepareOutline(
  initial: ProjectData,
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void = () => {},
): Promise<ProjectData> {
  if (initial.project.checkpoint !== 'paper-ready') throw new Error('论文尚未完成理解，不能规划大纲');
  onStage(GENERATION_STEPS[3]);
  const { strategy } = researchPrompt(initial.project.preferences.strategyId);
  const plan = await planDeck(
    initial.paper,
    { ...initial.project.preferences, strategyId: strategy.id },
    settings,
    signal,
  );
  const project = await saveStage(initial.project, { checkpoint: 'deck-plan-ready', plan }, signal);
  return { ...initial, project, plan };
}

export async function buildPresentation(
  initial: ProjectData,
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void = () => {},
): Promise<ProjectData> {
  if (initial.project.checkpoint !== 'deck-plan-ready' || !initial.plan) throw new Error('请先确认有效的汇报计划');
  if (initial.plan.status !== 'confirmed') throw new Error('未确认的汇报计划不能生成幻灯片');
  onStage(GENERATION_STEPS[4]);
  const { strategy } = researchPrompt(initial.project.preferences.strategyId);
  const deck = await generateDeck(initial.plan, initial.paper, initial.project.preferences, settings, signal);
  const project = await saveStage(initial.project, { checkpoint: 'deck-ready', deck, strategyId: strategy.id }, signal);
  return { ...initial, project, deck, plan: undefined };
}

// 只有完整阶段进入存储；取消和刷新后由持久化检查点决定下一步。
export async function generateProject(
  initial: ProjectData,
  resource: PdfResource,
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void,
  onSaved: (data: ProjectData) => void,
  onWarning: (message: string) => void,
) {
  let data = initial;
  while (data.project.checkpoint !== 'deck-ready') {
    signal.throwIfAborted();
    const captured = data.project;
    switch (captured.checkpoint) {
      case 'project-created': {
        onStage(GENERATION_STEPS[0]);
        const paper = await parsePaper(resource, data.paper, signal);
        const project = await saveStage(captured, { checkpoint: 'pdf-parsed', paper }, signal);
        data = { ...data, project, paper };
        break;
      }
      case 'pdf-parsed': {
        onStage(GENERATION_STEPS[1]);
        const paper = await analyzeFigures(data.paper, resource, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'figures-ready', paper }, signal);
        data = { ...data, project, paper };
        break;
      }
      case 'figures-ready': {
        onStage(GENERATION_STEPS[2]);
        const result = await understandPaper(data.paper, settings, captured.preferences.instruction, signal);
        const project = await saveStage(captured, { checkpoint: 'paper-ready', ...result }, signal);
        data = { ...data, project, paper: result.paper };
        break;
      }
      case 'paper-ready': {
        onStage(GENERATION_STEPS[3]);
        const { strategy, fallback } = researchPrompt(captured.preferences.strategyId);
        if (fallback) onWarning('原研究叙事策略已不可用，本次生成使用通用策略。');
        const plan = await planDeck(data.paper, { ...captured.preferences, strategyId: strategy.id }, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'deck-plan-ready', plan }, signal);
        data = { ...data, project, plan };
        break;
      }
      case 'deck-plan-ready': {
        onStage(GENERATION_STEPS[4]);
        if (!data.plan) throw new Error('已保存的汇报计划缺失，请保留项目并检查本地存储');
        const { strategy, fallback } = researchPrompt(captured.preferences.strategyId);
        if (fallback) onWarning('原研究叙事策略已不可用，本次生成使用通用策略。');
        const deck = await generateDeck(data.plan, data.paper, captured.preferences, settings, signal);
        const project = await saveStage(captured, { checkpoint: 'deck-ready', deck, strategyId: strategy.id }, signal);
        data = { ...data, project, deck, plan: undefined };
        break;
      }
    }
    onSaved(data);
  }
  return data;
}
