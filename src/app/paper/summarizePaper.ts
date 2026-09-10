import { z } from 'zod';
import { applyUnitResult, PaperAnalysisError } from '../../modules/paper/analysisUnits';
import type { Paper } from '../../modules/paper/model';
import { MetadataSchema, StorySchema, StudyProfileSchema } from '../../modules/paper/paper.schema';
import { createSummaryContext } from './summaryContext';
import { type SummaryReferences, validateSummaryReferences, withSummaryReferences } from './summaryReferences';

export const SummarySchema = z.strictObject({
  metadata: MetadataSchema,
  studyProfile: StudyProfileSchema,
  story: StorySchema,
});
export type PaperSummary = z.infer<typeof SummarySchema>;
export const SUMMARY_CONTEXT_CHAR_LIMIT = 120_000;
export const SUMMARY_LEAF_CHAR_TARGET = 60_000;
const CONTEXT_OVERHEAD = 12_000;
const PARTIAL_SUMMARY_CHAR_LIMIT = 18_000;
const SYNTHESIS_GUIDANCE =
  'claimIds/sourceIds仅使用当前请求allowedReferences对应词表中的短ID，不生成或猜测ID；e是证据不能填入sourceIds。Summary是主题综合，不是完整底稿的逐条副本。每个有依据的主题通常用1至3个综合点，合并相同结论；只为科学上不可合并的关键差异增加点。保留主要组别、方向、重要定量差异、冲突和限制，用必要的已有引用支持每点，不机械罗列全部Claim或Source ID。完整Claim/Evidence另行保存，不能把不逐条复述误认为删除底稿。目标JSON约4000至8000字符，硬上限18000字符；优先简洁综合，禁止截断正文或引用、不用空结果规避。';
const BATCH_GUIDANCE =
  '这是同一论文完整汇总的分批请求。claim-with-evidence将发现和全部关联证据一起提供；共享证据可能重复，不重复计数。relationship-fragment仅包含明确标注身份与关系的部分正文，不能当成完整结论，也不假定能看到其他批次；保留限定与未知，不凭缺失片段推断。所有原始发现和证据由程序持有，本请求不删改它们。studyContext是主论文设计或开篇的精确来源摘录，只在原文实际支持时引用设计陈述；本批设计资料不足须明确标注未明确，不以无关结果支撑设计。保留方向、限制和引用。局部Summary的JSON总长不得超过18000字符；压缩叙述而不是改写或删除底稿。';
const MERGE_GUIDANCE =
  '这是分批Summary的合并请求。全部原始发现与证据已在叶子批次完整提供并由程序保留；融合所有输入Summary的设计、发现、局限及跨文件关系，不增加未提供的科学结论，保持短引用。返回同一Summary结构，JSON总长不得超过18000字符。';

/** 双重序列化覆盖 JSON 文本在模型 Context 内的转义；另留 Schema、封装与有限修复提示余量。 */
export function summaryContextChars(data: unknown, prompt: string) {
  return JSON.stringify(JSON.stringify(data)).length + JSON.stringify(prompt).length + CONTEXT_OVERHEAD;
}
type SummaryRequest = (
  data: unknown,
  prompt: string,
  validate: (result: PaperSummary) => void,
) => Promise<PaperSummary>;
type Compact = ReturnType<typeof createSummaryContext>['data'];
type SummaryRecord =
  | { kind: 'claim-with-evidence'; claim: Compact['claims'][number]; evidences: Compact['evidences'] }
  | { kind: 'evidence'; value: Compact['evidences'][number] }
  | { kind: 'primary-opening'; value: string }
  | { kind: 'metadata'; value: Compact['metadata'] };

function pack<T>(items: T[], context: (items: T[]) => unknown, prompt: string, target = SUMMARY_CONTEXT_CHAR_LIMIT) {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (summaryContextChars(context(candidate), prompt) <= target) {
      current = candidate;
      continue;
    }
    if (current.length) groups.push(current);
    current = [item];
    if (summaryContextChars(context(current), prompt) > SUMMARY_CONTEXT_CHAR_LIMIT)
      throw new PaperAnalysisError('summary-context', '汇总单元仍超过自动处理范围，已保存的全文与发现保留，请重试。');
  }
  if (current.length) groups.push(current);
  return groups;
}
function splitRecord(record: SummaryRecord, context: (records: unknown[]) => unknown, prompt: string): unknown[] {
  if (summaryContextChars(context([record]), prompt) <= SUMMARY_LEAF_CHAR_TARGET) return [record];
  let identity: unknown;
  let texts: { ownerKind: string; ownerId: string; text: string }[];
  if (record.kind === 'claim-with-evidence') {
    const { text, ...claim } = record.claim;
    identity = {
      kind: 'relationship-fragment',
      claim,
      evidences: record.evidences.map(({ summary: _summary, ...evidence }) => evidence),
      incompleteText: true,
    };
    texts = [
      { ownerKind: 'claim', ownerId: claim.id, text },
      ...record.evidences.map((evidence) => ({ ownerKind: 'evidence', ownerId: evidence.id, text: evidence.summary })),
    ];
  } else if (record.kind === 'evidence') {
    const { summary, ...evidence } = record.value;
    identity = { kind: 'evidence-fragment', evidence, incompleteText: true };
    texts = [{ ownerKind: 'evidence', ownerId: evidence.id, text: summary }];
  } else {
    identity = { kind: `${record.kind}-fragment`, incompleteText: true };
    texts = [
      {
        ownerKind: record.kind,
        ownerId: record.kind,
        text: typeof record.value === 'string' ? record.value : JSON.stringify(record.value),
      },
    ];
  }
  return texts.flatMap(({ text, ...owner }) => {
    let size = 16_000;
    while (size > 0) {
      const pieces: string[] = [];
      for (let start = 0; start < text.length; ) {
        let end = Math.min(text.length, start + size);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        if (end <= start) end = start + Math.min(2, text.length - start);
        pieces.push(text.slice(start, end));
        start = end;
      }
      const fragments = pieces.map((value, part) => ({
        identity,
        textFragment: { ...owner, part, parts: pieces.length, text: value },
      }));
      if (fragments.every((fragment) => summaryContextChars(context([fragment]), prompt) <= SUMMARY_CONTEXT_CHAR_LIMIT))
        return fragments;
      size = Math.floor(size / 2);
    }
    throw new PaperAnalysisError('summary-context', '一条发现的关系身份无法加入汇总请求，已保存内容保留，请重试。');
  });
}

/** 全部原始记录进入叶子请求；只有局部 Summary 递归合并，最终由调用方一次原子提交。 */
export async function summarizePaper({
  paper,
  prompt,
  signal,
  request,
  onProgress = () => {},
}: {
  paper: Paper;
  prompt: string;
  signal: AbortSignal;
  request: SummaryRequest;
  onProgress?: (stage: string) => void;
}): Promise<PaperSummary> {
  const context = createSummaryContext(paper);
  const validate = (result: PaperSummary, partial: boolean, allowed: SummaryReferences) => {
    validateSummaryReferences(result, allowed);
    if (partial && JSON.stringify(result).length > PARTIAL_SUMMARY_CHAR_LIMIT)
      throw new PaperAnalysisError(
        'summary-output-size',
        '局部汇总过长，请保留证据引用并压缩叙述至18000字符内，不删改原始发现。',
      );
    try {
      applyUnitResult(paper, { stage: 'evidence', target: { kind: 'paper' }, result: context.restore(result) });
    } catch {
      throw new PaperAnalysisError('invalid-summary', '汇总引用了不存在的发现或来源。');
    }
  };
  async function ask(data: { allowedReferences: SummaryReferences }, instruction: string, partial: boolean) {
    signal.throwIfAborted();
    if (summaryContextChars(data, instruction) > SUMMARY_CONTEXT_CHAR_LIMIT)
      throw new PaperAnalysisError('summary-context', '汇总请求尚未拆分完成，已保存内容保留，请重试。');
    const result = await request(data, instruction, (value) => validate(value, partial, data.allowedReferences));
    signal.throwIfAborted();
    validate(result, partial, data.allowedReferences);
    return result;
  }
  const completeData = withSummaryReferences(context.data);
  const synthesisPrompt = `${prompt}\n${SYNTHESIS_GUIDANCE}`;
  const outputTooLong = (cause: unknown) =>
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === 'summary-output-size' || cause.code === 'truncated');
  if (summaryContextChars(completeData, synthesisPrompt) <= SUMMARY_LEAF_CHAR_TARGET) {
    try {
      return context.restore(await ask(completeData, synthesisPrompt, true));
    } catch (cause) {
      signal.throwIfAborted();
      if (!outputTooLong(cause)) throw cause;
    }
  }

  const primary = paper.documents.find((document) => document.role === 'primary');
  const designPattern =
    /randomi[sz]|study design|phase [1-4i]+|clinical trial|we (?:used|conducted|investigated)|methods|研究设计|随机|临床试验|本研究|我们采用/i;
  const sourceExcerpts = paper.sources
    .filter(
      (source) =>
        source.documentId === primary?.id &&
        source.kind === 'text' &&
        source.textQuote &&
        (source.pageNumber === 1 || designPattern.test(source.textQuote)),
    )
    .sort((a, b) => Number(designPattern.test(b.textQuote!)) - Number(designPattern.test(a.textQuote!)))
    .slice(0, 4)
    .map((source) => ({
      sourceId: context.shortId(source.id),
      pageNumber: source.pageNumber,
      quote: source.textQuote!.slice(0, 1800),
    }));
  const frame = {
    referenceFormat: context.data.referenceFormat,
    documents: context.data.documents,
    studyContext: { documentId: primary?.id, fileName: primary?.fileName, sourceExcerpts },
  };
  const batchPrompt = `${synthesisPrompt}\n${BATCH_GUIDANCE}`;
  const batchContext = (records: unknown[]) => withSummaryReferences({ ...frame, phase: 'partial-summary', records });
  const evidenceById = new Map(context.data.evidences.map((evidence) => [evidence.id, evidence]));
  const referenced = new Set(context.data.claims.flatMap((claim) => claim.evidenceIds));
  const records: SummaryRecord[] = [
    { kind: 'metadata', value: context.data.metadata },
    ...context.data.primaryOpening.map((value): SummaryRecord => ({ kind: 'primary-opening', value })),
    ...context.data.claims.map(
      (claim): SummaryRecord => ({
        kind: 'claim-with-evidence',
        claim,
        evidences: claim.evidenceIds.map((id) => evidenceById.get(id)!),
      }),
    ),
    ...context.data.evidences
      .filter((evidence) => !referenced.has(evidence.id))
      .map((value): SummaryRecord => ({ kind: 'evidence', value })),
  ];
  const fragments = records.flatMap((record) => splitRecord(record, batchContext, batchPrompt));
  const batches = pack(fragments, batchContext, batchPrompt, SUMMARY_LEAF_CHAR_TARGET);
  async function summarizeBatch(batch: unknown[]): Promise<PaperSummary[]> {
    try {
      return [await ask(batchContext(batch), batchPrompt, true)];
    } catch (cause) {
      signal.throwIfAborted();
      if (!outputTooLong(cause) || batch.length < 2) throw cause;
      onProgress('汇总输出较长，自动细分当前批次');
      const middle = Math.ceil(batch.length / 2);
      const left = await summarizeBatch(batch.slice(0, middle));
      const right = await summarizeBatch(batch.slice(middle));
      return [...left, ...right];
    }
  }
  let summaries: PaperSummary[] = [];
  for (const [index, batch] of batches.entries()) {
    onProgress(`分批汇总全部发现与证据 · ${index + 1}/${batches.length}`);
    summaries.push(...(await summarizeBatch(batch)));
  }
  const mergePrompt = `${synthesisPrompt}\n${MERGE_GUIDANCE}`;
  const mergeContext = (partialSummaries: PaperSummary[]) =>
    withSummaryReferences({
      ...frame,
      phase: 'merge-summaries',
      summaries: partialSummaries,
    });
  let level = 1;
  while (summaries.length > 1) {
    // Two completed summaries form one input; a remaining singleton carries forward without regeneration.
    const groups: PaperSummary[][] = [];
    for (let index = 0; index < summaries.length; index += 2) groups.push(summaries.slice(index, index + 2));
    const merged: PaperSummary[] = [];
    for (const [index, group] of groups.entries()) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }
      onProgress(`整合跨批次证据 · 第 ${level} 层 ${index + 1}/${groups.length}`);
      try {
        merged.push(await ask(mergeContext(group), mergePrompt, true));
      } catch (cause) {
        signal.throwIfAborted();
        if (!outputTooLong(cause)) throw cause;
        if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'truncated')
          throw new PaperAnalysisError(
            'summary-truncated',
            '两份局部摘要合并的模型输出未完成，已保存底稿保留，请重试汇总。',
          );
        throw new PaperAnalysisError(
          'summary-output-size',
          '两份局部摘要合并后仍超过输出范围，原始全文、发现和证据已保留，请重试汇总。',
        );
      }
    }
    summaries = merged;
    level++;
  }
  return context.restore(summaries[0]);
}
