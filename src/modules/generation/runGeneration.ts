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
  onSaved: (data: ProjectData) => void = () => {},
): Promise<ProjectData> {
  signal.throwIfAborted();
  let data = initial;
  const captured = data.project;
  if (captured.checkpoint === 'project-created') {
    onStage(GENERATION_STEPS[0]);
    const paper = await parsePaper(resource, data.paper, signal);
    const project = await saveStage(captured, { checkpoint: 'pdf-parsed', paper }, signal);
    data = { ...data, project, paper };
    onSaved(data);
  }
  if (data.project.checkpoint === 'pdf-parsed') {
    onStage(GENERATION_STEPS[1]);
    const paper = await analyzeFigures(data.paper, resource, settings, signal);
    const project = await saveStage(data.project, { checkpoint: 'figures-ready', paper }, signal);
    data = { ...data, project, paper };
    onSaved(data);
  }
  if (data.project.checkpoint === 'figures-ready') {
    onStage(GENERATION_STEPS[2]);
    const result = await understandPaper(data.paper, settings, data.project.preferences.instruction, signal);
    const project = await saveStage(data.project, { checkpoint: 'paper-ready', ...result }, signal);
    data = { ...data, project, paper: result.paper };
    onSaved(data);
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
