import { describe, expect, it } from 'vitest';
import { createModelRequests } from '../../src/app/llm/requests';
import {
  type PaperSummary,
  SUMMARY_CONTEXT_CHAR_LIMIT,
  SUMMARY_LEAF_CHAR_TARGET,
  SummarySchema,
  summarizePaper,
  summaryContextChars,
} from '../../src/app/paper/summarizePaper';
import { createSummaryContext } from '../../src/app/paper/summaryContext';
import { SummaryReferenceError } from '../../src/app/paper/summaryReferences';
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

describe('bounded complete-paper summary', () => {
  it('keeps each finding with all its evidence in bounded batches, restores sources and leaves the complete paper intact', async () => {
    const paper = largePaper();
    paper.claims[0].evidenceIds.push(paper.evidences[1].id);
    paper.evidences.push({ ...paper.evidences[0], id: 'orphan-evidence' });
    const before = structuredClone(paper);
    const compact = createSummaryContext(paper);
    const calls: BatchContext[] = [];
    const output = await summarizePaper({
      paper,
      prompt: '完整论文汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        expect(summaryContextChars(raw, prompt)).toBeLessThanOrEqual(SUMMARY_CONTEXT_CHAR_LIMIT);
        const data = raw as BatchContext;
        calls.push(data);
        expect(data).not.toHaveProperty('orientationEvidence');
        for (const excerpt of data.studyContext.sourceExcerpts) {
          const source = paper.sources.find((item) => compact.shortId(item.id) === excerpt.sourceId)!;
          expect(source.documentId).toBe(paper.documents.find((item) => item.role === 'primary')!.id);
          expect(source.textQuote!.startsWith(excerpt.quote)).toBe(true);
        }
        const ids =
          data.phase === 'partial-summary'
            ? data
                .records!.filter((record) => record.kind === 'claim-with-evidence')
                .slice(0, 1)
                .map((record) => record.claim!.id)
            : [
                ...new Set(
                  data.summaries!.flatMap((item) => item.story.mainFindings.flatMap((point) => point.claimIds)),
                ),
              ];
        const result = summary(ids, ['d0p1s0'], true);
        validate(result);
        return result;
      },
    });
    const leaves = calls.filter((call) => call.phase === 'partial-summary');
    for (const leaf of leaves)
      expect(summaryContextChars(leaf, '完整论文汇总')).toBeLessThanOrEqual(SUMMARY_LEAF_CHAR_TARGET);
    expect(leaves.length).toBeGreaterThan(2);
    const merges = calls.filter((call) => call.phase === 'merge-summaries');
    expect(merges).toHaveLength(leaves.length - 1);
    for (const merge of merges) expect(merge.summaries).toHaveLength(2);
    expect(new Set(leaves.map((leaf) => JSON.stringify(leaf))).size).toBe(leaves.length);
    const records = leaves.flatMap((call) => call.records!);
    const relationships = records.filter((record) => record.kind === 'claim-with-evidence');
    expect(relationships.map((record) => record.claim)).toEqual(compact.data.claims);
    for (const record of relationships) {
      expect(record.evidences!.map((item) => item.id)).toEqual(record.claim!.evidenceIds);
    }
    const delivered = records.flatMap((record) =>
      record.kind === 'claim-with-evidence' ? record.evidences! : record.kind === 'evidence' ? [record.value!] : [],
    );
    expect(new Map(delivered.map((item) => [item.id, item]))).toEqual(
      new Map(compact.data.evidences.map((item) => [item.id, item])),
    );
    expect(delivered.filter((item) => item.id === compact.data.evidences[1].id)).toHaveLength(2);
    expect(output.studyProfile.sourceIds).toEqual([paper.sources[0].id]);
    expect(output.story.mainFindings[0].claimIds.every((id) => paper.claims.some((claim) => claim.id === id))).toBe(
      true,
    );
    expect(paper).toEqual(before);
  });

  it('delivers every oversized text fragment with its explicit complete relationship identity', async () => {
    const paper = largePaper(1, 180000);
    const before = structuredClone(paper);
    const fragments: BatchRecord[] = [];
    const compact = createSummaryContext(paper);
    await summarizePaper({
      paper,
      prompt: '完整论文汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        expect(summaryContextChars(raw, prompt)).toBeLessThanOrEqual(SUMMARY_CONTEXT_CHAR_LIMIT);
        const data = raw as BatchContext;
        if (data.phase === 'partial-summary') fragments.push(...data.records!.filter((record) => record.textFragment));
        const result = summary(['c0']);
        validate(result);
        return result;
      },
    });
    for (const fragment of fragments) {
      expect(fragment.identity!.kind).toBe('relationship-fragment');
      expect(fragment.identity!.evidences.map((item) => item.id)).toEqual(fragment.identity!.claim.evidenceIds);
    }
    for (const [ownerKind, ownerId, fullText] of [
      ['claim', compact.data.claims[0].id, compact.data.claims[0].text],
      ['evidence', compact.data.evidences[0].id, compact.data.evidences[0].summary],
    ]) {
      const pieces = fragments
        .map((item) => item.textFragment!)
        .filter((item) => item.ownerKind === ownerKind && item.ownerId === ownerId)
        .sort((a, b) => a.part - b.part);
      expect(pieces.length).toBeGreaterThan(1);
      expect(pieces).toHaveLength(pieces[0].parts);
      expect(pieces.map((item) => item.text).join('')).toBe(fullText);
    }
    expect(paper).toEqual(before);
  });

  it.each(['summary-output-size', 'truncated'])(
    'subdivides only a %s batch with smaller inputs and no missing relationships',
    async (code) => {
      const paper = largePaper(40);
      const before = structuredClone(paper);
      const compact = createSummaryContext(paper);
      const attempted: BatchRecord[][] = [];
      const accepted: BatchRecord[] = [];
      let oversized = 0;
      await summarizePaper({
        paper,
        prompt: '完整论文汇总',
        signal: new AbortController().signal,
        request: async (raw, prompt, validate) => {
          expect(prompt).toContain('主题综合');
          expect(summaryContextChars(raw, prompt)).toBeLessThanOrEqual(SUMMARY_CONTEXT_CHAR_LIMIT);
          const data = raw as BatchContext;
          if (data.phase === 'partial-summary') {
            attempted.push(data.records!);
            if (data.records!.length > 5) {
              oversized++;
              if (code === 'truncated') throw Object.assign(new Error('incomplete model output'), { code });
              const result = summary();
              result.story.mainFindings[0].text = '逐条复述'.repeat(5000);
              // The shared model unit performs its single repair before surfacing this code.
              try {
                validate(result);
              } catch (cause) {
                throw Object.assign(new Error('bounded repair exhausted'), { code: (cause as { code: string }).code });
              }
            }
            accepted.push(...data.records!);
          }
          const result = summary();
          validate(result);
          return result;
        },
      });
      expect(oversized).toBeGreaterThan(0);
      expect(new Set(attempted.map((records) => JSON.stringify(records))).size).toBe(attempted.length);
      const relationships = accepted.filter((record) => record.kind === 'claim-with-evidence');
      expect(relationships.map((record) => record.claim)).toEqual(compact.data.claims);
      for (const record of relationships)
        expect(record.evidences!.map((item) => item.id)).toEqual(record.claim!.evidenceIds);
      expect(paper).toEqual(before);
    },
  );

  it.each(['summary-output-size', 'truncated'])(
    'reports %s for a failed pair without repeating completed leaf requests',
    async (code) => {
      const paper = largePaper(80);
      const before = structuredClone(paper);
      const leaves: string[] = [];
      let mergeRequests = 0;
      let repairAttempts = 0;
      await expect(
        summarizePaper({
          paper,
          prompt: '完整论文汇总',
          signal: new AbortController().signal,
          request: async (raw, _prompt, validate) => {
            const data = raw as BatchContext;
            const result = summary(
              data.allowedReferences.claimIds.slice(0, 1),
              data.allowedReferences.sourceIds.slice(0, 1),
            );
            if (data.phase === 'partial-summary') {
              leaves.push(JSON.stringify(data));
              validate(result);
              return result;
            }
            mergeRequests++;
            if (code === 'truncated') throw Object.assign(new Error('incomplete model output'), { code });
            expect(data.summaries).toHaveLength(2);
            result.story.mainFindings[0].text = '合并仍逐条复述'.repeat(4000);
            for (let attempt = 0; attempt < 2; attempt++) {
              repairAttempts++;
              try {
                validate(result);
              } catch (cause) {
                if (attempt)
                  throw Object.assign(new Error('bounded repair exhausted'), {
                    code: (cause as { code: string }).code,
                  });
              }
            }
            throw new Error('oversized result unexpectedly accepted');
          },
        }),
      ).rejects.toMatchObject({
        code: code === 'truncated' ? 'summary-truncated' : code,
        message: expect.stringContaining('两份局部摘要'),
      });
      expect(leaves.length).toBeGreaterThan(2);
      expect(new Set(leaves).size).toBe(leaves.length);
      expect(mergeRequests).toBe(1);
      expect(repairAttempts).toBe(code === 'truncated' ? 0 : 2);
      expect(paper).toEqual(before);
    },
  );

  it('stops remaining summary batches on cancellation without modifying the original paper', async () => {
    const paper = largePaper(80);
    const before = structuredClone(paper);
    const cancel = new AbortController();
    let calls = 0;
    await expect(
      summarizePaper({
        paper,
        prompt: '完整论文汇总',
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

  it('restricts references to each readable batch, diagnoses unknown paths privately and budgets the actual tool context', async () => {
    const paper = largePaper(40);
    paper.sources.push({
      id: 'primary-design-source',
      documentId: paper.documents[0].id,
      pageNumber: 1,
      kind: 'text',
      textQuote: 'Randomized phase 1 study of two groups.',
    });
    const compact = createSummaryContext(paper);
    let measured = 0;
    let maxContext = 0;
    const stop = new Error('capture only');
    await summarizePaper({
      paper,
      prompt: '完整论文汇总',
      signal: new AbortController().signal,
      request: async (raw, prompt, validate) => {
        const data = raw as BatchContext;
        for (const excerpt of data.studyContext.sourceExcerpts) {
          expect(excerpt.sourceId).toMatch(/^d\d+p\d+s\d+$/);
          expect(data.allowedReferences.sourceIds).toContain(excerpt.sourceId);
        }
        const missingInBatch = compact.data.claims.find((claim) => !data.allowedReferences.claimIds.includes(claim.id));
        if (data.phase === 'partial-summary' && missingInBatch) {
          const invalid = summary([missingInBatch.id], ['e0']);
          try {
            validate(invalid);
            throw new Error('unexpected valid reference');
          } catch (cause) {
            expect(cause).toBeInstanceOf(SummaryReferenceError);
            const error = cause as SummaryReferenceError;
            expect(error.repairDiagnostic).toContain('story.mainFindings[0].claimIds[0]');
            expect(error.repairDiagnostic).toContain(missingInBatch.id);
            expect(error.repairDiagnostic).toContain('studyProfile.sourceIds[0]');
            expect(error.repairDiagnostic).toContain('e0');
            expect(error.repairDiagnostic.length).toBeLessThanOrEqual(2000);
            expect(error.message).not.toContain(missingInBatch.id);
            expect(error.message).not.toContain('e0');
          }
        }
        const requests = createModelRequests({
          describe: () => {
            throw stop;
          },
          request: async (input) => {
            const chars = JSON.stringify(input.context).length;
            maxContext = Math.max(maxContext, chars);
            expect(input.maxTokens).toBe(24576);
            expect(chars).toBeLessThanOrEqual(summaryContextChars(raw, prompt));
            expect(Math.ceil(chars / 2) + input.maxTokens!).toBeLessThan(120000);
            measured++;
            throw stop;
          },
        });
        await expect(
          requests.requestJson({
            settings: DEFAULT_SETTINGS,
            systemPrompt: prompt,
            data: raw,
            schema: SummarySchema,
            signal: new AbortController().signal,
            stage: 'understand-summary',
            maxTokens: 24576,
          }),
        ).rejects.toBe(stop);
        const result = summary(
          data.allowedReferences.claimIds.slice(0, 1),
          data.allowedReferences.sourceIds.slice(0, 1),
        );
        validate(result);
        return result;
      },
    });
    expect(measured).toBeGreaterThan(2);
    console.log(
      'summary actual request context max chars:',
      maxContext,
      'estimated tokens:',
      Math.ceil(maxContext / 2) + 24576,
    );
  });
});
