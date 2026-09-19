import { prompts } from '../../src/infrastructure/llm/prompts';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisUnitError, preparePaper, type AnalysisEvent } from '../../src/app/workflows/preparePaper';
import type { AnalysisProject, AnalysisStore, UnitCommit, PaperResource } from '../../src/app/paper/ports';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { validatePaper } from '../../src/modules/paper/model';
import {
  applyPageSelection,
  applyUnitResult,
  getAnalysisProgress,
  getUnitInputKey,
  PaperAnalysisError,
  unitId,
  unitComplete,
} from '../../src/modules/paper/analysisUnits';
import { ModelError, ModelOutputError } from '../../src/app/llm/modelError';
import { StoryTopics } from '../../src/modules/paper/paper.schema';

const fullText = (documentId: string, page: number) =>
  `Fig. 1. ${documentId} page ${page}: complete scientific caption. Methods retain a dose of 0.25 mg and every inclusion criterion. Findings retain all observations and limitations. 原句、换行\n与科学符号 β 均保留。`;
const target = (documentId: string, pageNumber = 1) => ({ kind: 'page' as const, documentId, pageNumber });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type ModelCall = {
  stage: string;
  maxTokens?: number;
  data: {
    document?: { id: string; fileName: string };
    pageNumber?: number;
    sources?: AnalysisProject['paper']['sources'];
    claims?: AnalysisProject['paper']['claims'];
    evidences?: AnalysisProject['paper']['evidences'];
    blocks?: AnalysisProject['paper']['blocks'];
  };
};

function fixture(pageCount = 1, settings = DEFAULT_SETTINGS) {
  let data: AnalysisProject = {
    project: {
      schemaVersion: 2,
      id: 'project',
      name: '双文件',
      paperId: 'paper',
      checkpoint: 'project-created',
      preferences: { instruction: 'only two slides' },
      lastOpenedStep: 'paper-analysis',
      createdAt: 1,
      updatedAt: 1,
    },
    paper: validatePaper({
      schemaVersion: 2,
      id: 'paper',
      projectId: 'project',
      revision: 0,
      documents: [
        { id: 'main', role: 'primary', fileName: 'main.pdf', pdfAssetId: 'main-asset' },
        { id: 'supplement', role: 'supplement', fileName: 'supplement.pdf', pdfAssetId: 'supplement-asset' },
      ],
      metadata: {},
      pages: [],
      blocks: [],
      figurePageSelections: [],
      analysisUnits: [],
      sources: [],
      figures: [],
      figureReview: { revision: 0 },
      pendingEvidenceFigureIds: [],
      claims: [],
      evidences: [],
    }),
    assets: {
      main: { blob: new Blob(['main']), name: 'main.pdf' },
      supplement: { blob: new Blob(['supplement']), name: 'supplement.pdf' },
    },
  };
  const commits: UnitCommit[] = [];
  const textCalls: string[] = [];
  const modelCalls: ModelCall[] = [];
  const disposed: string[] = [];
  let beforeModel: ((call: ModelCall) => Promise<void>) | undefined;
  let beforeCommit: ((input: UnitCommit) => void) | undefined;
  const snapshot = () => structuredClone(data);
  const store: AnalysisStore = {
    openProject: async () => snapshot(),
    commitUnit: async (input) => {
      beforeCommit?.(input);
      input.signal.throwIfAborted();
      if (input.inputKey !== getUnitInputKey(data.paper, input.stage, input.target))
        throw new PaperAnalysisError('stale-unit', '固定存储拒绝过期输入');
      const changed = applyUnitResult(data.paper, input);
      const id = unitId(input.stage, input.target);
      changed.analysisUnits = [
        ...changed.analysisUnits.filter((unit) => unit.id !== id),
        {
          id,
          stage: input.stage,
          target: input.target,
          inputKey: input.inputKey,
          outcome: input.outcome ?? 'completed',
          completedAt: 1,
        },
      ];
      changed.revision++;
      data = { ...data, paper: validatePaper(changed) };
      commits.push(input);
      return snapshot();
    },
    setPageSelection: async (input) => {
      data = { ...data, paper: applyPageSelection(data.paper, input) };
      return snapshot();
    },
    saveRequirements: async () => undefined,
    openStep: async () => undefined,
  };
  const createResource = (blob: Blob): PaperResource => {
    const documentId = Object.entries(data.assets).find(([, asset]) => asset.blob === blob)?.[0];
    // openProject clones Blob wrappers, so identify the fixed resource using its body at first read.
    let identity = documentId;
    const identify = async () => {
      if (!identity) identity = await blob.text();
      return identity;
    };
    return {
      pageCount: async () => pageCount,
      title: async () => `${await identify()} title`,
      text: async (page, signal) => {
        signal.throwIfAborted();
        const id = await identify();
        textCalls.push(`${id}:${page}`);
        const text = fullText(id, page);
        return { width: 600, height: 800, text, blocks: [{ text }] };
      },
      discover: async () => ({ hasImages: false }),
      figureInput: async () => ({ image: 'data:image/png;base64,fixed', imageRegions: [] }),
      preview: async () => 'data:image/png;base64,fixed',
      dispose: async () => {
        disposed.push(await identify());
      },
    };
  };
  const requestJson = async (call: ModelCall) => {
    modelCalls.push(call);
    await beforeModel?.(call);
    if (call.stage === 'figures')
      return {
        figures: [
          {
            label: 'Fig. 1',
            caption: 'complete caption',
            description: 'observed result',
            bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 },
            panels: [{ label: 'A', description: 'panel A', bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.6 } }],
          },
        ],
      };
    if (call.stage === 'understand-page')
      return {
        claims: [
          {
            id: 'claim',
            text: `${call.data.document?.id} finding`,
            strength: 'descriptive',
            importance: 'primary',
            evidenceIds: ['evidence'],
          },
        ],
        evidences: [
          {
            id: 'evidence',
            kind: 'direct',
            summary: 'fixed complete observation',
            sourceIds: [call.data.sources![0].id],
          },
        ],
      };
    const story = Object.fromEntries(StoryTopics.map((topic) => [topic, []]));
    story.mainFindings = [
      { text: 'joint material findings', claimIds: call.data.claims!.map((claim) => claim.id), sourceIds: [] },
    ] as never[];
    return {
      metadata: { title: 'main title' },
      studyProfile: {
        type: 'experimental',
        designSummary: 'both documents',
        sourceIds: [call.data.evidences![0].sourceIds[0]],
      },
      story,
    };
  };
  const run = (signal = new AbortController().signal, onProgress: (event: AnalysisEvent) => void = () => {}) =>
    preparePaper({
      prompts,
      projectId: 'project',
      settings,
      store,
      createResource,
      requests: { requestJson } as unknown as Parameters<typeof preparePaper>[0]['requests'],
      signal,
      onProgress,
    });
  return {
    run,
    store,
    snapshot,
    commits,
    textCalls,
    modelCalls,
    disposed,
    onModel: (hook: typeof beforeModel) => {
      beforeModel = hook;
    },
    onCommit: (hook: typeof beforeCommit) => {
      beforeCommit = hook;
    },
  };
}

it('页级模型任务跟随并发配置，默认五个而非隐藏上限二', async () => {
  const setup = fixture(4);
  const gate = deferred();
  let started = 0;
  setup.onModel(async (call) => {
    if (call.stage !== 'figures') return;
    started++;
    await gate.promise;
  });
  const pending = setup.run();
  await vi.waitFor(() => expect(started).toBe(5));
  gate.resolve();
  await pending;
  expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
});

describe('M15 complete paper workflow', () => {
  it('locates a repaired failure by its own document and page after siblings update progress', async () => {
    const setup = fixture(2);
    const held = deferred();
    const events: AnalysisEvent[] = [];
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main' && call.data.pageNumber === 2) {
        await held.promise;
        throw new ModelOutputError('figures', { privateProviderBody: 'must-not-reach-ui' }, [
          { code: 'invalid-shape', path: 'figures', message: 'fixed invalid shape' },
        ]);
      }
    });
    const running = setup.run(undefined, (event) => events.push(event)).catch((cause: unknown) => cause);
    await vi.waitFor(() =>
      expect(
        setup.commits.some(
          (unit) =>
            unit.stage === 'figure-location' &&
            unit.target.kind === 'page' &&
            unit.target.documentId === 'supplement' &&
            unit.target.pageNumber === 2,
        ),
      ).toBe(true),
    );
    expect([...events].reverse().find((event) => event.documentId)?.documentId).toBe('supplement');
    held.resolve();
    const error = await running;
    expect(error).toBeInstanceOf(AnalysisUnitError);
    expect(error).toMatchObject({ stage: 'figures', code: 'invalid-output', documentId: 'main', pageNumber: 2 });
    expect((error as Error).message).toContain('main.pdf · 第 2 页');
    expect((error as AnalysisUnitError).recovery).toContain('已保存单元保留');
    expect(JSON.stringify(error)).not.toContain('must-not-reach-ui');
    expect(
      setup.modelCalls
        .filter((call) => call.stage === 'figures' && call.data.document?.id === 'main' && call.data.pageNumber === 2)
        .map((call) => call.maxTokens),
    ).toEqual([16384, 16384]);
    expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(false);
  });

  it('merges out-of-order sibling units and separates identical pages, Figure labels and panel labels across documents', async () => {
    const setup = fixture();
    const held = deferred();
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main') await held.promise;
    });
    const running = setup.run();
    await vi.waitFor(() =>
      expect(
        setup.commits.some(
          (unit) =>
            unit.stage === 'figure-location' && unit.target.kind === 'page' && unit.target.documentId === 'supplement',
        ),
      ).toBe(true),
    );
    held.resolve();
    await running;
    const paper = setup.snapshot().paper;
    expect(getAnalysisProgress(paper).ready).toBe(true);
    expect(unitComplete(paper, 'text', { documentId: 'main', pageNumber: 1, kind: 'page' })).toBe(true);
    expect(paper.figures).toHaveLength(2);
    expect(paper.figures.map((figure) => figure.label)).toEqual(['Fig. 1', 'Fig. 1']);
    expect(new Set(paper.sources.map((source) => source.id)).size).toBe(paper.sources.length);
    expect(paper.claims.map((claim) => claim.id).sort()).toEqual([
      'finding:main:1:claim',
      'finding:supplement:1:claim',
    ]);
    expect(setup.disposed.sort()).toEqual(['main', 'supplement']);
    expect(setup.snapshot().project.lastOpenedStep).toBe('paper-analysis');
  });

  it('retains complete blocks and exact source spans regardless of reporting preferences', async () => {
    const setup = fixture();
    await setup.run();
    const paper = setup.snapshot().paper;
    expect(paper.blocks.map((block) => block.text)).toEqual([fullText('main', 1), fullText('supplement', 1)]);
    for (const source of paper.sources.filter((source) => source.textSpan)) {
      const block = paper.blocks.find((block) => block.id === source.textSpan!.blockId)!;
      expect(source.textQuote).toBe(block.text.slice(source.textSpan!.start, source.textSpan!.end));
      expect(source.documentId).toBe(block.documentId);
    }
    const summary = setup.modelCalls.find((call) => call.stage === 'understand-summary')!;
    expect(summary.data.claims).toHaveLength(2);
    expect(summary.data.claims?.map(({ text, strength, importance }) => ({ text, strength, importance }))).toEqual(
      paper.claims.map(({ text, strength, importance }) => ({ text, strength, importance })),
    );
    expect(summary.data.claims?.map((claim) => claim.evidenceIds)).toEqual(
      paper.claims.map((claim) =>
        claim.evidenceIds.map((id) => `e${paper.evidences.findIndex((item) => item.id === id)}`),
      ),
    );
    expect(summary.data.evidences?.map(({ kind, summary }) => ({ kind, summary }))).toEqual(
      paper.evidences.map(({ kind, summary }) => ({ kind, summary })),
    );
    expect(paper.studyProfile?.sourceIds.every((id) => paper.sources.some((source) => source.id === id))).toBe(true);
    for (const call of setup.modelCalls.filter((item) => item.stage === 'understand-page')) {
      expect(call.data.blocks?.map((block) => block.text)).toEqual([fullText(call.data.document!.id, 1)]);
    }
    expect(JSON.stringify(summary.data)).toContain('0.25 mg');
    expect(JSON.stringify(summary.data)).toContain('supplement');
  });

  it('keeps saved units after cancellation and manually resumes only missing units', async () => {
    const setup = fixture(2);
    const cancel = new AbortController();
    await expect(
      setup.run(cancel.signal, (event) => {
        if (event.stage === '已保存' && event.data?.paper.analysisUnits.length === 1) cancel.abort('paused');
      }),
    ).rejects.toBe('paused');
    const saved = setup.snapshot().paper.analysisUnits.filter((unit) => unit.stage === 'text');
    expect(saved).toHaveLength(1);
    const first = saved[0].target;
    expect(first.kind).toBe('page');
    const before = setup.textCalls.filter(
      (key) => first.kind === 'page' && key === `${first.documentId}:${first.pageNumber}`,
    ).length;
    await setup.run();
    const after = setup.textCalls.filter(
      (key) => first.kind === 'page' && key === `${first.documentId}:${first.pageNumber}`,
    ).length;
    expect(after).toBe(before);
    expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
  });

  it('rejects late figure output after manual exclusion and preserves the other document', async () => {
    const setup = fixture();
    const held = deferred();
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main') await held.promise;
    });
    const running = setup.run();
    await vi.waitFor(() =>
      expect(setup.modelCalls.some((call) => call.stage === 'figures' && call.data.document?.id === 'main')).toBe(true),
    );
    const originalSources = setup.snapshot().paper.sources.filter((source) => source.textSpan);
    await setup.store.setPageSelection({
      projectId: 'project',
      documentId: 'main',
      pageNumber: 1,
      expectedRevision: setup.snapshot().paper.figurePageSelections.find((page) => page.documentId === 'main')!
        .revision,
      manualOverride: 'exclude',
    });
    held.resolve();
    await running;
    const paper = setup.snapshot().paper;
    expect(paper.figurePageSelections.find((page) => page.documentId === 'main')?.manualOverride).toBe('exclude');
    expect(paper.sources.filter((source) => source.textSpan)).toEqual(originalSources);
    expect(paper.sources.filter((source) => source.documentId === 'main' && source.kind === 'figure')).toHaveLength(0);
    expect(
      paper.sources.filter((source) => source.documentId === 'supplement' && source.kind === 'figure'),
    ).toHaveLength(1);
    expect(getAnalysisProgress(paper).ready).toBe(true);
  });

  it('does not mark a failed save complete and retries only the unsaved target', async () => {
    const setup = fixture();
    setup.onCommit((input) => {
      if (input.stage === 'evidence' && input.target.kind === 'page' && input.target.documentId === 'supplement')
        throw new Error('save-failed');
    });
    await expect(setup.run()).rejects.toThrow('save-failed');
    const before = setup.snapshot().paper;
    expect(getAnalysisProgress(before).ready).toBe(false);
    const mainCalls = setup.modelCalls.filter(
      (call) => call.stage === 'understand-page' && call.data.document?.id === 'main',
    ).length;
    setup.onCommit(undefined);
    await setup.run();
    expect(
      setup.modelCalls.filter((call) => call.stage === 'understand-page' && call.data.document?.id === 'main'),
    ).toHaveLength(mainCalls);
    expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
  });

  it('retries truncated model output with a larger budget and completes the paper', async () => {
    const setup = fixture();
    let truncated = true;
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main' && truncated) {
        truncated = false;
        throw new ModelError('figures', 'truncated', '模型输出未完成');
      }
    });

    await setup.run();

    expect(
      setup.modelCalls
        .filter((call) => call.stage === 'figures' && call.data.document?.id === 'main')
        .map((call) => call.maxTokens),
    ).toEqual([16384, 24576]);
    expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
    expect(setup.modelCalls.find((call) => call.stage === 'understand-summary')?.maxTokens).toBe(24576);
  });

  it('stops after a second truncation and manually resumes without repeating saved units', async () => {
    const setup = fixture();
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main')
        throw new ModelError('figures', 'truncated', '模型输出未完成');
    });

    await expect(setup.run()).rejects.toMatchObject({
      stage: 'figures',
      code: 'truncated',
      documentId: 'main',
      pageNumber: 1,
    });
    expect(
      setup.modelCalls
        .filter((call) => call.stage === 'figures' && call.data.document?.id === 'main')
        .map((call) => call.maxTokens),
    ).toEqual([16384, 24576]);
    const saved = setup.snapshot().paper;
    expect(unitComplete(saved, 'text', target('main'))).toBe(true);
    expect(unitComplete(saved, 'figure-location', target('main'))).toBe(false);
    expect(unitComplete(saved, 'figure-location', target('supplement'))).toBe(true);
    expect(getAnalysisProgress(saved).ready).toBe(false);
    const textCalls = [...setup.textCalls];
    const supplementCalls = setup.modelCalls.filter(
      (call) => call.stage === 'figures' && call.data.document?.id === 'supplement',
    ).length;

    setup.onModel(undefined);
    await setup.run();

    expect(setup.textCalls).toEqual(textCalls);
    expect(
      setup.modelCalls.filter((call) => call.stage === 'figures' && call.data.document?.id === 'supplement'),
    ).toHaveLength(supplementCalls);
    expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
  });

  it.each([16384, 65536])(
    'uses configured output %i without retrying truncation at the same limit',
    async (maxOutputTokens) => {
      const setup = fixture(1, { ...DEFAULT_SETTINGS, maxOutputTokens });
      setup.onModel(async (call) => {
        if (call.stage === 'figures' && call.data.document?.id === 'main')
          throw new ModelError('figures', 'truncated', '模型输出未完成');
      });
      await expect(setup.run()).rejects.toMatchObject({ stage: 'figures', code: 'truncated' });
      expect(
        setup.modelCalls.filter((call) => call.stage === 'figures' && call.data.document?.id === 'main'),
      ).toHaveLength(1);
      expect(setup.modelCalls.every((call) => call.maxTokens === maxOutputTokens)).toBe(true);
      expect(unitComplete(setup.snapshot().paper, 'figure-location', target('main'))).toBe(false);
      setup.onModel(undefined);
      await setup.run();
      expect(setup.modelCalls.every((call) => call.maxTokens === maxOutputTokens)).toBe(true);
      expect(getAnalysisProgress(setup.snapshot().paper).ready).toBe(true);
    },
  );

  it('does not retry truncated output after cancellation', async () => {
    const setup = fixture();
    const cancel = new AbortController();
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main') {
        cancel.abort('paused');
        throw new ModelError('figures', 'truncated', '模型输出未完成');
      }
    });

    await expect(setup.run(cancel.signal)).rejects.toBe('paused');
    expect(
      setup.modelCalls.filter((call) => call.stage === 'figures' && call.data.document?.id === 'main'),
    ).toHaveLength(1);
    expect(unitComplete(setup.snapshot().paper, 'figure-location', target('main'))).toBe(false);
  });

  it('does not retry non-truncation model errors', async () => {
    const setup = fixture();
    setup.onModel(async (call) => {
      if (call.stage === 'figures' && call.data.document?.id === 'main')
        throw new ModelError('figures', 'model-request', '模型请求失败');
    });

    await expect(setup.run()).rejects.toMatchObject({ stage: 'figures', code: 'model-request' });
    expect(
      setup.modelCalls.filter((call) => call.stage === 'figures' && call.data.document?.id === 'main'),
    ).toHaveLength(1);
  });

  it('records empty exclusions immediately and waits for refreshed evidence after removing saved figures', async () => {
    const setup = fixture();
    await setup.run();
    const before = setup.snapshot().paper;
    const selected = before.figurePageSelections.find((page) => page.documentId === 'main')!;
    await setup.store.setPageSelection({
      projectId: 'project',
      documentId: 'main',
      pageNumber: 1,
      expectedRevision: selected.revision,
      manualOverride: 'exclude',
      confirmRemoval: true,
    });
    const excluded = setup.snapshot().paper;
    const pending = excluded.figurePageSelections.find((page) => page.documentId === 'main')!;
    expect(pending.processedRevision).not.toBe(pending.revision);
    expect(getAnalysisProgress(excluded).ready).toBe(false);
    expect(
      excluded.figures.every((figure) =>
        figure.regions.every(
          (region) => excluded.sources.find((source) => source.id === region.sourceId)?.documentId === 'supplement',
        ),
      ),
    ).toBe(true);
    await setup.run();
    const refreshed = setup.snapshot().paper;
    expect(getAnalysisProgress(refreshed).ready).toBe(true);
    expect(refreshed.figurePageSelections.every((page) => page.processedRevision === page.revision)).toBe(true);
    const empty = refreshed.figurePageSelections.find((page) => page.documentId === 'main')!;
    const automaticNegative = structuredClone(refreshed);
    automaticNegative.figurePageSelections.find((page) => page.documentId === 'main')!.automatic = 'not-detected';
    const cleared = applyPageSelection(automaticNegative, {
      documentId: 'main',
      pageNumber: 1,
      expectedRevision: empty.revision,
    });
    const clearedPage = cleared.figurePageSelections.find((page) => page.documentId === 'main')!;
    expect(clearedPage.processedRevision).toBe(clearedPage.revision);
    const stale = structuredClone(refreshed);
    stale.figurePageSelections[0].processedRevision = undefined;
    expect(getAnalysisProgress(stale).ready).toBe(false);
  });
  it('keeps unrelated text input identities stable while sibling page results are merged', () => {
    const setup = fixture();
    const original = setup.snapshot().paper;
    const before = getUnitInputKey(original, 'text', target('supplement'));
    const changed = applyUnitResult(original, {
      stage: 'text',
      target: target('main'),
      result: {
        width: 600,
        height: 800,
        pageCount: 1,
        blocks: [{ id: 'main-block', kind: 'paragraph', text: fullText('main', 1) }],
      },
    });
    expect(getUnitInputKey(changed, 'text', target('supplement'))).toBe(before);
    expect(original.blocks).toHaveLength(0);
  });
});
