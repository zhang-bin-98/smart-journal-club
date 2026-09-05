import { z } from 'zod';
import { fixturePaper } from '../src/fixtures';
import { mapUnderstanding, UnderstandingSchema } from '../src/analysis';
import { prompts } from '../src/prompts';
import { parsePromptFiles } from '../src/prompt-config';
import { createProject, deleteProject, loadProject, saveStage } from '../src/storage';
import { DEFAULT_SETTINGS, requestJson } from '../src/model';
import type { Paper } from '../src/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function rejected(work: () => unknown | Promise<unknown>) { let failed = false; try { await work(); } catch { failed = true; } assert(failed, '应拒绝非法结果'); }
function understanding(paper: Paper) {
  const sourceId = paper.sources[0].id;
  return { supported: true, strategyId: 'general', metadata: { title: '固定检查论文' },
    studyProfile: { type: '固定研究类型', designSummary: '固定设计说明', sourceIds: [sourceId] },
    claims: [{ id: 'claim-temp', text: '固定结论', strength: 'descriptive', importance: 'primary', evidenceIds: ['evidence-temp'] }],
    evidences: [{ id: 'evidence-temp', kind: '图源', summary: '固定证据说明', sourceIds: [sourceId] }],
    story: { background: [], knowledgeGap: [], question: [], studyDesign: [], mainFindings: [{ text: '固定发现', claimIds: ['claim-temp'], sourceIds: [] }], novelty: [], limitations: [], conclusion: [] },
  };
}
export async function runAnalysisContracts() {
  const created = await createProject(new File(['%PDF-fixture'], 'analysis.pdf'));
  const paper = { ...structuredClone(fixturePaper), id: created.paperId };
  const signal = new AbortController().signal;
  let project = await saveStage(created, { checkpoint: 'pdf-parsed', paper }, signal);
  project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
  const raw = understanding(paper); const result = mapUnderstanding(paper, raw);
  assert(result.paper.claims[0].id !== 'claim-temp', '模型临时 ID 应由应用分配');
  assert(result.paper.claims[0].evidenceIds[0] === result.paper.evidences[0].id, '映射后证据链必须连通');
  assert(result.paper.story!.mainFindings[0].claimIds[0] === result.paper.claims[0].id, '故事点必须指向映射后的 Claim');
  const saved = await saveStage(project, { checkpoint: 'paper-ready', ...result }, signal);
  assert(saved.preferences.strategyId === 'general', '策略必须与阶段同步保存');
  const broken = structuredClone(raw); broken.evidences[0].sourceIds = ['missing'];
  await rejected(() => mapUnderstanding(paper, broken));
  const noEvidence = structuredClone(raw); noEvidence.claims[0].evidenceIds = [];
  await rejected(() => mapUnderstanding(paper, noEvidence));
  await rejected(() => mapUnderstanding(paper, { ...raw, strategyId: 'missing' }));
  await rejected(() => mapUnderstanding(paper, { supported: false, reason: '综述不支持' }));
  assert((await loadProject(project.id)).paper.claims[0].id === result.paper.claims[0].id, '非法结果不得覆盖稳定 Paper');
  await deleteProject(project.id);
  const files: Record<string, string> = { 'prompts/common.md': prompts.common, ...Object.fromEntries(Object.entries(prompts.stages).map(([id, body]) => [`prompts/stages/${id}.md`, body])),
    ...Object.fromEntries(prompts.strategies.map(strategy => [`prompts/research/${strategy.id}.md`, `---\nname: ${strategy.name}\ndescription: ${strategy.description}\n---\n${strategy.body}`])),
  };
  assert(parsePromptFiles(files).strategies.length === 5, '同一解析器应加载全部初始策略');
  await rejected(() => parsePromptFiles({ ...files, 'prompts/research/general.md': '---\nname: x\n---\nbody' }));
  const missingGeneral = { ...files }; delete missingGeneral['prompts/research/general.md'];
  await rejected(() => parsePromptFiles(missingGeneral));
  assert(UnderstandingSchema.safeParse(raw).success, '固定响应应符合唯一阶段 Schema');
  return 'PASS: evidence mapping/primary claims/strategy/atomic paper-ready/invalid output/prompt config';
}
export async function fixedModelRequest() {
  return requestJson({ ...DEFAULT_SETTINGS, apiKey: 'fixed-test-key' }, 'Return JSON.', { test: true }, z.strictObject({ connected: z.literal(true) }), new AbortController().signal, 'fixed-check');
}
