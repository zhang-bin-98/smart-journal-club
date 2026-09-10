import { PaperAnalysisError } from '../../modules/paper/analysisUnits';
import type { PaperSummary } from './summarizePaper';

export type SummaryReferences = { claimIds: string[]; sourceIds: string[] };

/** 词表仅来自当前请求可读关系和设计摘录，不授权引用其他批次的底稿。 */
export function withSummaryReferences<T extends object>(data: T): T & { allowedReferences: SummaryReferences } {
  const claims = new Set<string>();
  const sources = new Set<string>();
  function visit(value: unknown, key = '') {
    if (Array.isArray(value)) {
      if (key === 'claimIds') for (const id of value) claims.add(id);
      else if (key === 'sourceIds') for (const id of value) sources.add(id);
      else for (const item of value) visit(item, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if ((key === 'claim' || key === 'claims') && typeof record.id === 'string') claims.add(record.id);
    if (typeof record.sourceId === 'string') sources.add(record.sourceId);
    for (const [child, item] of Object.entries(record)) visit(item, child);
  }
  visit(data);
  return { ...data, allowedReferences: { claimIds: [...claims], sourceIds: [...sources] } };
}

/** 详细诊断只供唯一修复请求使用；面向 UI 的 message 不含模型原始内容。 */
export class SummaryReferenceError extends PaperAnalysisError {
  constructor(readonly repairDiagnostic: string) {
    super('invalid-summary', '汇总引用未通过当前批次来源校验，已保存底稿保留。');
  }
}

export function validateSummaryReferences(result: PaperSummary, allowed: SummaryReferences) {
  const diagnostics: string[] = [];
  let length = 0;
  function check(ids: string[], permitted: string[], path: string) {
    const vocabulary = new Set(permitted);
    for (const [index, id] of ids.entries()) {
      if (vocabulary.has(id) || length >= 1750) continue;
      const issue = `${path}[${index}]: 未在本批 allowedReferences 中出现的 ID ${JSON.stringify(id.slice(0, 120))}`;
      diagnostics.push(issue);
      length += issue.length;
    }
  }
  check(result.studyProfile.sourceIds, allowed.sourceIds, 'studyProfile.sourceIds');
  for (const [topic, points] of Object.entries(result.story)) {
    for (const [index, point] of points.entries()) {
      check(point.claimIds, allowed.claimIds, `story.${topic}[${index}].claimIds`);
      check(point.sourceIds, allowed.sourceIds, `story.${topic}[${index}].sourceIds`);
    }
  }
  if (diagnostics.length)
    throw new SummaryReferenceError(
      (
        diagnostics.join('\n') +
        '\n仅使用本请求 allowedReferences 内且实际支持叙述的短 ID；c 是 Claim，e 是 Evidence，sourceIds 只能用 d…p…s…，不猜测或替换为无关引用。'
      ).slice(0, 2000),
    );
}
