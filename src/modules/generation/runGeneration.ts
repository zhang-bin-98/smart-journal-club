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
