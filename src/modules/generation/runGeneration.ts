import { researchPrompt } from '../../shared/llm/prompts';
import type { ModelSettings } from '../../shared/llm/model';
import { analyzeFigures, understandPaper } from '../paper/analysis';
import { parsePaper } from '../paper/parsePaper';
import type { PdfResource } from '../../shared/pdf/pdfResource';
import { loadProject, saveStage, type ProjectData } from '../project/projectRepository';
import { planDeck } from './planDeck';
import { generateDeck } from './buildDeck';
import { captureGenerationBase, saveCandidate, commitCandidate } from './candidateRepository';
import type { Project } from '../project/project.schema';

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
  preferences: Project['preferences'] = initial.project.preferences,
): Promise<ProjectData> {
  if (!['paper-ready', 'deck-ready'].includes(initial.project.checkpoint))
    throw new Error('论文尚未完成理解，不能规划大纲');
  const base =
    initial.project.checkpoint === 'deck-ready' ? await captureGenerationBase(initial.project.id) : undefined;
  onStage(GENERATION_STEPS[3]);
  const { strategy } = researchPrompt(preferences.strategyId);
  const plan = await planDeck(initial.paper, { ...preferences, strategyId: strategy.id }, settings, signal);
  if (base) {
    const planRecord = await saveCandidate(
      {
        recordVersion: 1,
        projectId: initial.project.id,
        mode: 'regeneration',
        base,
        plan,
        preferences: { ...preferences, strategyId: strategy.id },
      },
      signal,
    );
    return { ...initial, plan, planRecord, candidateStale: false };
  }
  const project = await saveStage(initial.project, { checkpoint: 'deck-plan-ready', plan }, signal);
  return { ...initial, project, plan };
}

export async function buildPresentation(
  initial: ProjectData,
  settings: ModelSettings,
  signal: AbortSignal,
  onStage: (stage: string) => void = () => {},
): Promise<ProjectData> {
  if (!['deck-plan-ready', 'deck-ready'].includes(initial.project.checkpoint) || !initial.plan)
    throw new Error('请先确认有效的汇报计划');
  if (initial.candidateStale) throw new Error('候选已过期，请放弃后重新规划');
  if (initial.plan.status !== 'confirmed') throw new Error('未确认的汇报计划不能生成幻灯片');
  const latest = await loadProject(initial.project.id);
  if (
    !latest.plan ||
    latest.plan.id !== initial.plan.id ||
    latest.plan.revision !== initial.plan.revision ||
    latest.plan.status !== 'confirmed' ||
    latest.candidateStale
  )
    throw new Error('大纲版本或候选基准已变化，请重新打开项目');
  signal.throwIfAborted();
  onStage(GENERATION_STEPS[4]);
  const preferences = initial.planRecord?.preferences ?? initial.project.preferences;
  const { strategy } = researchPrompt(preferences.strategyId);
  const deck = await generateDeck(initial.plan, initial.paper, preferences, settings, signal);
  const project =
    initial.planRecord?.mode === 'regeneration'
      ? await commitCandidate({ ...initial.planRecord, plan: initial.plan }, deck, signal)
      : await saveStage(
          initial.project,
          {
            checkpoint: 'deck-ready',
            deck,
            strategyId: strategy.id,
            planId: initial.plan.id,
            planRevision: initial.plan.revision,
          },
          signal,
        );
  return { ...initial, project, deck, plan: undefined, planRecord: undefined, candidateStale: false };
}
