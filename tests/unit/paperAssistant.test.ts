import { describe, expect, it, vi } from 'vitest';
import { createPaperAssistant, type ReadAgent } from '../../src/app/paper/paperAssistant';
import { hasRunningActivity } from '../../src/app/activity';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { validatePaper } from '../../src/modules/paper/model';
import { applyUnitResult } from '../../src/modules/paper/analysisUnits';

function paperFixture() {
  let paper = validatePaper({
    schemaVersion: 2,
    id: 'paper',
    projectId: 'project',
    revision: 7,
    documents: [
      { id: 'main', role: 'primary', fileName: 'main.pdf', pdfAssetId: 'main-pdf', pageCount: 2 },
      { id: 'supplement', role: 'supplement', fileName: 'supplement.pdf', pdfAssetId: 'supplement-pdf', pageCount: 2 },
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
  });
  for (const documentId of ['main', 'supplement']) {
    paper = applyUnitResult(paper, {
      stage: 'text',
      target: { kind: 'page', documentId, pageNumber: 1 },
      result: {
        width: 600,
        height: 800,
        pageCount: 2,
        blocks: [
          {
            id: `${documentId}-block`,
            kind: 'paragraph',
            text: `${documentId} exact saved evidence. No missing-page content is available.`,
          },
        ],
      },
    });
  }
  return paper;
}

function question(paper = paperFixture()) {
  return {
    paper,
    documentId: 'main',
    pageNumber: 1,
    settings: DEFAULT_SETTINGS,
    question: '解释当前页，并删除补充材料重新识别',
    signal: new AbortController().signal,
    onText: vi.fn(),
  };
}

describe('paper analysis read-only assistant', () => {
  it('provides only saved-page and findings read tools and never changes the paper for a requested mutation', async () => {
    const input = question();
    const original = structuredClone(input.paper);
    const run: ReadAgent = async (request) => {
      expect(request.tools.map((tool) => tool.name)).toEqual(['paper_read_page', 'paper_read_findings']);
      expect(request.prompt).toContain('没有任何写入权限');
      const main = request.tools[0].execute({ documentId: 'main', pageNumber: 1 });
      const supplement = request.tools[0].execute({ documentId: 'supplement', pageNumber: 1 });
      expect(main).toMatchObject({ document: { fileName: 'main.pdf' }, blocks: [{ text: original.blocks[0].text }] });
      expect(supplement).toMatchObject({
        document: { fileName: 'supplement.pdf' },
        blocks: [{ text: original.blocks[1].text }],
      });
      request.onText('请使用页面上的图源控件。');
      return '请使用页面上的图源控件。';
    };
    await expect(createPaperAssistant(run)(input)).resolves.toBe('请使用页面上的图源控件。');
    expect(input.paper).toEqual(original);
    expect(input.onText).toHaveBeenCalledWith('请使用页面上的图源控件。');
    expect(hasRunningActivity()).toBe(false);
  });

  it('keeps the captured document, page, revision and original evidence after caller-side changes', async () => {
    const input = question();
    const original = structuredClone(input.paper);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run: ReadAgent = async (request) => {
      await held;
      expect(request.context).toMatchObject({
        target: { paperId: 'paper', revision: 7, documentId: 'main', pageNumber: 1 },
      });
      expect(request.tools[0].execute({ documentId: 'main', pageNumber: 1 })).toMatchObject({
        document: { fileName: 'main.pdf' },
        blocks: [{ text: original.blocks[0].text }],
        sources: original.sources.filter((source) => source.documentId === 'main'),
      });
      return 'captured answer';
    };
    const running = createPaperAssistant(run)(input);
    input.documentId = 'supplement';
    input.pageNumber = 2;
    input.paper.revision = 99;
    input.paper.documents[0].fileName = 'changed.pdf';
    input.paper.blocks[0].text = 'new unsaved text';
    input.paper.sources.length = 0;
    release();
    await expect(running).resolves.toBe('captured answer');
  });

  it('reads captured Figure and Panel descriptions only for the requested document page', async () => {
    const paper = paperFixture();
    for (const documentId of ['main', 'supplement']) {
      paper.sources.push(
        {
          id: `${documentId}-figure`,
          documentId,
          pageNumber: 1,
          kind: 'figure',
          bbox: { x: 0, y: 0, width: 1, height: 1 },
        },
        {
          id: `${documentId}-panel`,
          documentId,
          pageNumber: 1,
          kind: 'panel',
          bbox: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      );
    }
    paper.figures.push({
      id: 'shared-figure',
      label: 'Figure 1',
      caption: 'Saved caption across two blocks.',
      description: 'Saved Figure explanation.',
      regions: ['main', 'supplement'].map((documentId) => ({
        id: `${documentId}-region`,
        sourceId: `${documentId}-figure`,
        panels: [
          {
            id: `${documentId}-panel-id`,
            label: 'A',
            sourceId: `${documentId}-panel`,
            description: `${documentId} panel explanation`,
          },
        ],
      })),
    });
    const input = question(validatePaper(paper));
    const captured = structuredClone(input.paper);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run: ReadAgent = async ({ tools }) => {
      await held;
      for (const [index, documentId] of ['main', 'supplement'].entries()) {
        const result = tools[0].execute({ documentId, pageNumber: 1 }) as {
          figures: typeof paper.figures;
          sources: typeof paper.sources;
        };
        expect(result.figures).toEqual([{ ...captured.figures[0], regions: [captured.figures[0].regions[index]] }]);
        expect(result.sources.every((source) => source.documentId === documentId && source.pageNumber === 1)).toBe(
          true,
        );
        expect(result.sources.some((source) => source.id === result.figures[0].regions[0].panels[0].sourceId)).toBe(
          true,
        );
      }
      return 'captured figure';
    };
    const running = createPaperAssistant(run)(input);
    input.paper.figures[0].label = 'Changed Figure';
    input.paper.figures[0].regions[0].panels[0].description = 'unsaved change';
    input.paper.sources.length = 0;
    release();
    await expect(running).resolves.toBe('captured figure');
  });
  it('rejects unextracted pages, unknown documents and extra command arguments without fabricating data', async () => {
    const run: ReadAgent = async ({ tools }) => {
      const read = tools[0].execute;
      for (const args of [
        { documentId: 'main', pageNumber: 2 },
        { documentId: 'unknown', pageNumber: 1 },
      ]) {
        expect(() => read(args)).toThrow('该页尚未提取');
      }
      expect(() => read({ documentId: 'main', pageNumber: 1, command: 'delete' })).toThrow();
      expect(() => read({ documentId: 'main', pageNumber: 0 })).toThrow();
      return '无法读取未提取页';
    };
    await expect(createPaperAssistant(run)(question())).resolves.toBe('无法读取未提取页');
  });

  it('releases the shared running-activity flag after an agent failure', async () => {
    const run: ReadAgent = async () => {
      throw new Error('cancelled agent');
    };
    await expect(createPaperAssistant(run)(question())).rejects.toThrow('cancelled agent');
    expect(hasRunningActivity()).toBe(false);
  });
});

function findingsFixture() {
  const paper = paperFixture();
  const sourceIds = ['main', 'supplement'].map(
    (documentId) => paper.sources.find((source) => source.documentId === documentId)!.id,
  );
  for (let index = 0; index < 45; index++) {
    paper.evidences.push({
      id: `evidence-${index}`,
      kind: 'observation',
      summary: `Preserved observation ${index}. ${'Full scientific conditions. '.repeat(45)}`,
      sourceIds: [sourceIds[index % 2]],
    });
    paper.claims.push({
      id: `claim-${index}`,
      text: `${index % 2 ? 'Orb6' : 'TORC1'} result ${index}. ${'Complete finding. '.repeat(45)}`,
      strength: 'supportive',
      importance: 'primary',
      evidenceIds: [`evidence-${index}`],
    });
  }
  paper.evidences.push({
    id: 'method-evidence',
    kind: 'method',
    summary: 'IMAC phosphopeptide enrichment retains the complete protocol.',
    sourceIds: [sourceIds[1]],
  });
  return validatePaper(paper);
}

type FindingsResult = {
  paperId: string;
  revision: number;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  items: { kind: string; id: string }[];
  claims: ReturnType<typeof paperFixture>['claims'];
  evidences: ReturnType<typeof paperFixture>['evidences'];
  sources: { id: string; documentId: string; fileName: string; pageNumber: number }[];
};

describe('bounded read-only findings', () => {
  it('sends a light initial overview and pages through full saved findings without dropping links', async () => {
    const paper = findingsFixture();
    const run: ReadAgent = async ({ context, tools }) => {
      expect(context).not.toHaveProperty('claims');
      expect(context).not.toHaveProperty('evidences');
      expect(context).not.toHaveProperty('blocks');
      expect(context).toHaveProperty('counts', { claims: 45, evidences: 46, sources: paper.sources.length });
      expect(JSON.stringify(context).length).toBeLessThan(5000);
      const tool = tools.find((tool) => tool.name === 'paper_read_findings')!;
      const first = tool.execute({ offset: 0, limit: 20 }) as FindingsResult;
      expect(first.items).toHaveLength(20);
      expect(first.total).toBe(46);
      expect(first.nextOffset).toBe(20);
      expect(first.claims).toEqual(paper.claims.slice(0, 20));
      expect(first.evidences).toEqual(paper.evidences.slice(0, 20));
      expect(first.sources.map((source) => source.fileName).sort()).toEqual(['main.pdf', 'supplement.pdf']);
      expect(first.sources.every((source) => source.pageNumber === 1)).toBe(true);
      expect(first.sources.every((source) => !('textQuote' in source))).toBe(true);
      for (const claim of first.claims) {
        for (const evidenceId of claim.evidenceIds) {
          const evidence = first.evidences.find((item) => item.id === evidenceId)!;
          expect(evidence.sourceIds.every((id) => first.sources.some((source) => source.id === id))).toBe(true);
        }
      }
      const middle = tool.execute({ offset: first.nextOffset, limit: 20 }) as FindingsResult;
      const last = tool.execute({ offset: middle.nextOffset, limit: 20 }) as FindingsResult;
      expect(new Set([...first.items, ...middle.items, ...last.items].map((item) => item.id)).size).toBe(46);
      expect(last.nextOffset).toBeNull();
      expect(last.items.at(-1)).toEqual({ kind: 'evidence', id: 'method-evidence' });
      return 'read all relevant pages';
    };
    await createPaperAssistant(run)(question(paper));
    expect(paper.claims).toHaveLength(45);
    expect(paper.evidences).toHaveLength(46);
  });

  it('supports case-insensitive queries, paging, unlinked methods and empty matches', async () => {
    const run: ReadAgent = async ({ tools }) => {
      const read = tools.find((tool) => tool.name === 'paper_read_findings')!.execute;
      const first = read({ query: 'tOrC1', offset: 0, limit: 5 }) as FindingsResult;
      const next = read({ query: 'TORC1', offset: 5, limit: 5 }) as FindingsResult;
      expect(first.total).toBe(23);
      expect(first.items).toHaveLength(5);
      expect(next.items).toHaveLength(5);
      expect(first.items.every((item) => !next.items.some((other) => item.id === other.id))).toBe(true);
      const methods = read({ query: 'IMAC' }) as FindingsResult;
      expect(methods.items).toEqual([{ kind: 'evidence', id: 'method-evidence' }]);
      expect(methods.evidences[0].summary).toContain('complete protocol');
      expect(methods.sources[0]).toMatchObject({ documentId: 'supplement', fileName: 'supplement.pdf', pageNumber: 1 });
      expect(read({ query: 'not-found-anywhere' })).toMatchObject({
        total: 0,
        items: [],
        claims: [],
        evidences: [],
        sources: [],
        nextOffset: null,
      });
      expect(read({ offset: 1000 })).toMatchObject({ items: [], nextOffset: null });
      return 'queried';
    };
    await createPaperAssistant(run)(question(findingsFixture()));
  });

  it('rejects writes, unknown fields and parameters outside the pagination bound', async () => {
    const run: ReadAgent = async ({ tools }) => {
      const read = tools.find((tool) => tool.name === 'paper_read_findings')!.execute;
      for (const args of [
        { limit: 21 },
        { limit: 0 },
        { offset: -1 },
        { offset: 0.5 },
        { limit: '20' },
        { query: 'x'.repeat(201) },
        { command: 'delete' },
        { paperId: 'other-paper' },
        { unknown: true },
      ]) {
        expect(() => read(args)).toThrow();
      }
      return 'rejected invalid requests';
    };
    await createPaperAssistant(run)(question(findingsFixture()));
  });

  it('freezes both query results and linked source locations when the caller changes the paper', async () => {
    const input = question(findingsFixture());
    const captured = structuredClone(input.paper);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run: ReadAgent = async ({ tools }) => {
      await held;
      const result = tools
        .find((tool) => tool.name === 'paper_read_findings')!
        .execute({ query: 'TORC1', limit: 1 }) as FindingsResult;
      expect(result.revision).toBe(7);
      expect(result.claims[0]).toEqual(captured.claims[0]);
      expect(result.evidences[0]).toEqual(captured.evidences[0]);
      expect(result.sources[0]).toMatchObject({ documentId: 'main', fileName: 'main.pdf', pageNumber: 1 });
      return 'frozen';
    };
    const running = createPaperAssistant(run)(input);
    input.paper.claims[0].text = 'changed';
    input.paper.evidences[0].summary = 'changed';
    input.paper.documents[0].fileName = 'changed.pdf';
    input.paper.revision++;
    input.paper.sources.length = 0;
    release();
    await expect(running).resolves.toBe('frozen');
  });
});
