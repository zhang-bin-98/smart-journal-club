import { describe, expect, it } from 'vitest';
import { createModelRequests } from '../../src/app/llm/requests';
import {
  type PaperSummary,
  SummarySchema,
  summarizePaper,
  summaryInputTokens,
} from '../../src/app/paper/summarizePaper';
import { createSummaryContext } from '../../src/app/paper/summaryContext';
import { SummaryReferenceError } from '../../src/app/paper/summaryReferences';
import { estimateContextTokens } from '../../src/shared/modelCapacity';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { StoryTopics } from '../../src/modules/paper/evidence';
import { migratePaperV1 } from '../../src/modules/paper/migration';
import { validatePaper } from '../../src/modules/paper/model';
import { fixturePaper } from '../fixtures';
import { legacyProject } from '../legacy-fixtures';

function largePaper(count = 180, length = 2400) {
  const paper = migratePaperV1(
    fixturePaper,
    legacyProject({
      id: 'summary-project',
      paperId: fixturePaper.id,
      pdfAssetId: 'summary-asset',
      checkpoint: 'paper-ready',
    }),
    'main.pdf',
  );
  paper.story = undefined;
  paper.claims = Array.from({ length: count }, (_, index) => ({
    id: `long-claim-${index}`,
    text: `${index}:机制、组别、方向和限制。${'科学正文'.repeat(Math.ceil(length / 4))}`,
    strength: 'descriptive' as const,
    importance: 'primary' as const,
    evidenceIds: [`long-evidence-${index}`],
  }));
  paper.evidences = Array.from({ length: count }, (_, index) => ({
    id: `long-evidence-${index}`,
    kind: 'fixed',
    summary: `${index}:完整证据，保留剂量0.25mg与β。${'未删减证据'.repeat(Math.ceil(length / 5))}`,
    sourceIds: [paper.sources[0].id],
  }));
  return validatePaper(paper);
}
function summary(claimIds: string[] = [], sourceIds = ['d0p1s0'], long = false): PaperSummary {
  return {
    metadata: {},
    studyProfile: { type: '固定汇总', designSummary: '保留各批次来源', sourceIds },
    story: {
      ...Object.fromEntries(StoryTopics.map((topic) => [topic, []])),
      mainFindings: [{ text: long ? '固定摘要'.repeat(3600) : '完整记录在底稿保留', claimIds, sourceIds }],
    } as PaperSummary['story'],
  };
}
type Compact = ReturnType<typeof createSummaryContext>['data'];
type BatchRecord = {
  kind?: string;
  claim?: Compact['claims'][number];
  evidences?: Compact['evidences'];
  value?: Compact['evidences'][number];
  identity?: {
    kind: string;
    claim: Omit<Compact['claims'][number], 'text'>;
    evidences: Omit<Compact['evidences'][number], 'summary'>[];
  };
  textFragment?: { ownerKind: string; ownerId: string; part: number; parts: number; text: string };
};
type BatchContext = {
  phase: string;
  allowedReferences: { claimIds: string[]; sourceIds: string[] };
  studyContext: { sourceExcerpts: { sourceId: string; quote: string }[] };
  records?: BatchRecord[];
  summaries?: PaperSummary[];
};

const settings = { ...DEFAULT_SETTINGS, contextWindow: 24000, maxOutputTokens: 4096 };
const fits = (data: unknown, prompt: string) =>
  expect(summaryInputTokens(data, prompt) + settings.maxOutputTokens).toBeLessThanOrEqual(settings.contextWindow);
const resultFor = (data: BatchContext) =>
  summary(data.allowedReferences.claimIds.slice(0, 1), data.allowedReferences.sourceIds.slice(0, 1));

describe('按配置容量汇总完整论文', () => {
  it('百万上下文可一次处理，超过旧字符输出限制仍接受，原始内容不变', async () => {
    const paper = largePaper(40);
    const before = structuredClone(paper);
    let calls = 0;
    await summarizePaper({
      paper,
      settings: { ...settings, contextWindow: 1000000, maxOutputTokens: 384000 },
      prompt: '完整汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        calls++;
        const data = raw as Compact & BatchContext;
        expect(data.claims).toHaveLength(40);
        expect(summaryInputTokens(raw, prompt) + 384000).toBeLessThan(1000000);
        const result = resultFor(data);
        result.story.mainFindings[0].text = '完整综合'.repeat(5000);
        validate(result);
        return result;
      },
    });
    expect(calls).toBe(1);
    expect(paper).toEqual(before);
  });
  it('独立批次并发五个，按容量一次合并多份，保留所有发现及完整关联证据', async () => {
    const paper = largePaper(100);
    paper.claims[0].evidenceIds.push(paper.evidences[1].id);
    paper.evidences.push({ ...paper.evidences[0], id: 'orphan-evidence' });
    const before = structuredClone(paper);
    const compact = createSummaryContext(paper);
    const calls: BatchContext[] = [];
    let active = 0;
    let peak = 0;
    await summarizePaper({
      paper,
      settings,
      prompt: '完整汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        fits(raw, prompt);
        const data = raw as BatchContext;
        calls.push(data);
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        const result = resultFor(data);
        validate(result);
        return result;
      },
    });
    expect(peak).toBe(5);
    const leaves = calls.filter((call) => call.phase === 'partial-summary');
    expect(leaves.length).toBeGreaterThan(5);
    const relationships = leaves
      .flatMap((call) => call.records!)
      .filter((record) => record.kind === 'claim-with-evidence');
    expect(relationships.map((record) => record.claim)).toEqual(compact.data.claims);
    for (const record of relationships)
      expect(record.evidences!.map((item) => item.id)).toEqual(record.claim!.evidenceIds);
    const delivered = leaves
      .flatMap((call) => call.records!)
      .flatMap((record) =>
        record.kind === 'claim-with-evidence' ? record.evidences! : record.kind === 'evidence' ? [record.value!] : [],
      );
    expect(new Map(delivered.map((item) => [item.id, item]))).toEqual(
      new Map(compact.data.evidences.map((item) => [item.id, item])),
    );
    const merges = calls.filter((call) => call.phase === 'merge-summaries');
    expect(merges).toHaveLength(1);
    expect(merges[0].summaries!.length).toBe(leaves.length);
    expect(paper).toEqual(before);
  });
  it('超过输入容量的单条正文完整分片，保留身份、关系和 Unicode 原文', async () => {
    const paper = largePaper(1, 180000);
    paper.claims[0].text += '🧬';
    const before = structuredClone(paper);
    const compact = createSummaryContext(paper);
    const fragments: BatchRecord[] = [];
    await summarizePaper({
      paper,
      settings,
      prompt: '完整汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        fits(raw, prompt);
        const data = raw as BatchContext;
        if (data.phase === 'partial-summary') fragments.push(...data.records!.filter((record) => record.textFragment));
        const result = resultFor(data);
        validate(result);
        return result;
      },
    });
    for (const fragment of fragments) {
      expect(fragment.identity!.kind).toBe('relationship-fragment');
      expect(fragment.identity!.evidences.map((item) => item.id)).toEqual(fragment.identity!.claim.evidenceIds);
    }
    for (const [ownerKind, fullText] of [
      ['claim', compact.data.claims[0].text],
      ['evidence', compact.data.evidences[0].summary],
    ]) {
      const pieces = fragments
        .map((item) => item.textFragment!)
        .filter((item) => item.ownerKind === ownerKind)
        .sort((a, b) => a.part - b.part);
      expect(pieces.length).toBeGreaterThan(1);
      expect(pieces.map((item) => item.text).join('')).toBe(fullText);
    }
    expect(paper).toEqual(before);
  });
  it('仅截断的叶批细分，后续合并失败不重新请求已完成叶批', async () => {
    const paper = largePaper(40);
    const leaves: string[] = [];
    let split = false;
    await expect(
      summarizePaper({
        paper,
        settings: { ...settings, concurrency: 1 },
        prompt: '完整汇总',
        signal: new AbortController().signal,
        request: async (raw, prompt, validate) => {
          fits(raw, prompt);
          const data = raw as BatchContext;
          if (data.phase === 'merge-summaries')
            throw Object.assign(new Error('output incomplete'), { code: 'truncated' });
          leaves.push(JSON.stringify(data.records));
          if (data.records!.length > 4) {
            split = true;
            throw Object.assign(new Error('output incomplete'), { code: 'truncated' });
          }
          const result = resultFor(data);
          validate(result);
          return result;
        },
      }),
    ).rejects.toMatchObject({ code: 'summary-truncated' });
    expect(split).toBe(true);
    expect(new Set(leaves).size).toBe(leaves.length);
  });
  it('取消停止新批次且不修改论文', async () => {
    const paper = largePaper(80);
    const before = structuredClone(paper);
    const cancel = new AbortController();
    let calls = 0;
    await expect(
      summarizePaper({
        paper,
        settings,
        prompt: '完整汇总',
        signal: cancel.signal,
        request: async () => {
          calls++;
          cancel.abort('paused');
          return summary();
        },
      }),
    ).rejects.toBe('paused');
    expect(calls).toBe(1);
    expect(paper).toEqual(before);
  });
  it('完整研究设计摘录不受四条或1800字符限制，词表仍只授权当前可读来源', async () => {
    const paper = largePaper(40);
    for (let index = 0; index < 6; index++)
      paper.sources.push({
        id: `design-${index}`,
        documentId: paper.documents[0].id,
        pageNumber: 1,
        kind: 'text',
        textQuote: `Randomized study ${index}. ` + '完整研究设计。'.repeat(300),
      });
    let sharedAll = false;
    await summarizePaper({
      paper,
      settings: { ...settings, contextWindow: 60000 },
      prompt: '完整汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        const data = raw as BatchContext;
        if (data.studyContext.sourceExcerpts.filter((excerpt) => excerpt.quote.startsWith('Randomized')).length === 6)
          sharedAll = true;
        for (const excerpt of data.studyContext.sourceExcerpts) {
          if (excerpt.quote.startsWith('Randomized')) expect(excerpt.quote.length).toBeGreaterThan(1800);
        }
        const invalid = summary(['not-visible'], ['not-visible']);
        expect(() => validate(invalid)).toThrow(SummaryReferenceError);
        const result = resultFor(data);
        validate(result);
        const stop = new Error('capture only');
        const requests = createModelRequests({
          describe: () => {
            throw stop;
          },
          request: async (input) => {
            expect(estimateContextTokens(input.context)).toBe(summaryInputTokens(raw, prompt));
            throw stop;
          },
        });
        await expect(
          requests.requestJson({
            settings,
            systemPrompt: prompt,
            data: raw,
            schema: SummarySchema,
            signal: new AbortController().signal,
            stage: 'understand-summary',
          }),
        ).rejects.toBe(stop);
        return result;
      },
    });
    expect(sharedAll).toBe(true);
  });
});
