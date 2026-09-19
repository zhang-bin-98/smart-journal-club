import { type Paper, type AnalysisUnitRecord, validatePaper } from './model';
import { sectionContextBlocks, studyContextBlocks } from './contextBlocks';

type Stage = AnalysisUnitRecord['stage'];
type Target = AnalysisUnitRecord['target'];
export class PaperAnalysisError extends Error {
  readonly stage = 'paper-analysis';
  readonly recovery = '保留已保存内容，重新打开当前页后继续。';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const pageKey = (documentId: string, pageNumber: number) => `${documentId}:${pageNumber}`;
/** 调用方对象属性顺序不影响单元身份，兼容已保存的规范顺序。 */
export function unitId(stage: Stage, target: Target) {
  const identity =
    target.kind === 'page'
      ? { kind: target.kind, documentId: target.documentId, pageNumber: target.pageNumber }
      : target.kind === 'region'
        ? { kind: target.kind, figureId: target.figureId, regionId: target.regionId }
        : { kind: target.kind };
  return `${stage}:${JSON.stringify(identity)}`;
}
export function isSelected(selection: Paper['figurePageSelections'][number]) {
  return (
    selection.manualOverride === 'include' ||
    (selection.manualOverride !== 'exclude' && selection.automatic === 'detected')
  );
}

/** 只捕获单元的真实输入，无关页提交不使兄弟结果过期。 */
export function getUnitInputKey(paper: Paper, stage: Stage, target: Target): string {
  if (target.kind === 'paper')
    return JSON.stringify([
      'summary-v1',
      paper.documents,
      paper.blocks,
      paper.figures,
      paper.sources,
      paper.claims,
      paper.evidences,
    ]);
  if (target.kind === 'region') {
    const figure = paper.figures.find((item) => item.id === target.figureId);
    const region = figure?.regions.find((item) => item.id === target.regionId);
    return JSON.stringify([stage, region, paper.sources.filter((source) => source.id === region?.sourceId)]);
  }
  const document = paper.documents.find((item) => item.id === target.documentId);
  if (!document) throw new PaperAnalysisError('missing-document', '文件已不存在。');
  if (stage === 'text') return JSON.stringify(['text-v1', document.id, document.pdfAssetId, target.pageNumber]);
  const blocks = paper.blocks.filter(
    (item) => item.documentId === target.documentId && item.pageNumber === target.pageNumber,
  );
  if (stage === 'figure-discovery') return JSON.stringify(['discovery-v1', blocks]);
  const selection = paper.figurePageSelections.find(
    (item) => item.documentId === target.documentId && item.pageNumber === target.pageNumber,
  );
  if (stage === 'figure-location' || stage === 'panel-analysis')
    return JSON.stringify(['figures-v1', blocks, selection?.revision, selection && isSelected(selection)]);
  return JSON.stringify(['evidence-context-v3', getEvidenceContext(paper, target)]);
}
/** 相邻正文只补齐跨页语境；来源仍使用真实文件和原句身份。 */
export function getEvidenceContext(paper: Paper, target: { documentId: string; pageNumber: number }, legacy = false) {
  const blocksAt = (pageNumber: number) =>
    paper.blocks.filter((block) => block.documentId === target.documentId && block.pageNumber === pageNumber);
  const blocks = blocksAt(target.pageNumber);
  const before = blocksAt(target.pageNumber - 1);
  const after = blocksAt(target.pageNumber + 1);
  const contextBefore = legacy ? before.filter((block) => block.text.trim().length > 80).slice(-2) : before;
  const contextAfter = legacy ? after.filter((block) => block.text.trim().length > 80).slice(0, 2) : after;
  const documentBlocks = paper.blocks
    .filter((block) => block.documentId === target.documentId)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const sectionContext = legacy ? [] : sectionContextBlocks(documentBlocks, target.pageNumber);
  const primary = paper.documents.find((document) => document.role === 'primary');
  const studyContext = legacy
    ? []
    : studyContextBlocks(
        paper.blocks.filter((block) => block.documentId === primary?.id).sort((a, b) => a.pageNumber - b.pageNumber),
      );
  const adjacent = new Set(
    [...contextBefore, ...contextAfter, ...sectionContext, ...studyContext].map((block) => block.id),
  );
  const sources = paper.sources.filter(
    (source) =>
      (source.documentId === target.documentId && source.pageNumber === target.pageNumber) ||
      (source.textSpan && adjacent.has(source.textSpan.blockId)),
  );
  return { blocks, contextBefore, contextAfter, sources, ...(!legacy ? { sectionContext, studyContext } : {}) };
}
export function unitComplete(paper: Paper, stage: Stage, target: Target) {
  return (
    paper.analysisUnits.some(
      (unit) => unit.id === unitId(stage, target) && unit.inputKey === getUnitInputKey(paper, stage, target),
    ) ||
    (stage === 'evidence' &&
      target.kind === 'page' &&
      paper.analysisUnits.some(
        (unit) =>
          unit.id === unitId(stage, target) &&
          unit.inputKey === JSON.stringify(['evidence-context-v2', getEvidenceContext(paper, target, true)]),
      ))
  );
}
export function getAnalysisProgress(paper: Paper) {
  const documents = paper.documents.map((document) => {
    const pages = paper.pages.filter((page) => page.documentId === document.id);
    const target = (pageNumber: number): Target => ({ kind: 'page', documentId: document.id, pageNumber });
    const selections = paper.figurePageSelections.filter((page) => page.documentId === document.id);
    const selected = selections.filter(isSelected);
    return {
      ...document,
      total: document.pageCount,
      text: pages.filter((page) => unitComplete(paper, 'text', target(page.pageNumber))).length,
      discovery: pages.filter((page) => unitComplete(paper, 'figure-discovery', target(page.pageNumber))).length,
      figures: selected.filter((page) => unitComplete(paper, 'figure-location', target(page.pageNumber))).length,
      selected: selected.length,
      evidence: pages.filter((page) => unitComplete(paper, 'evidence', target(page.pageNumber))).length,
    };
  });
  const textReady = documents.every((doc) => doc.total !== undefined && doc.text === doc.total);
  const figuresReady =
    textReady && documents.every((doc) => doc.discovery === doc.total && doc.figures === doc.selected);
  const ready =
    figuresReady &&
    documents.every((doc) => doc.evidence === doc.total) &&
    unitComplete(paper, 'evidence', { kind: 'paper' }) &&
    !paper.pendingEvidenceFigureIds.length &&
    paper.figurePageSelections.every((page) => page.processedRevision === page.revision);
  return {
    documents,
    textReady,
    figuresReady,
    ready,
    completed: documents.reduce((sum, doc) => sum + doc.text, 0),
    total: documents.every((doc) => doc.total !== undefined)
      ? documents.reduce((sum, doc) => sum + (doc.total ?? 0), 0)
      : undefined,
  };
}

export type TextResult = {
  width: number;
  height: number;
  pageCount: number;
  blocks: { id: string; kind: Paper['blocks'][number]['kind']; text: string }[];
  metadataTitle?: string;
};
export type FigureResult = { sources: Paper['sources']; figures: Paper['figures'] };
export type EvidenceResult = {
  claims: Paper['claims'];
  evidences: Paper['evidences'];
  studyProfile?: Paper['studyProfile'];
  story?: Paper['story'];
  metadata?: Paper['metadata'];
};

/** 来源身份消失时整项失效其证据和发现，保留其他页底稿，由原单元续跑重建。 */
function invalidateRemovedSources(paper: Paper, removed: Set<string>) {
  if (!removed.size) return;
  const evidenceIds = new Set(
    paper.evidences.filter((item) => item.sourceIds.some((id) => removed.has(id))).map((item) => item.id),
  );
  paper.evidences = paper.evidences.filter((item) => !evidenceIds.has(item.id));
  paper.claims = paper.claims.filter((item) => !item.evidenceIds.some((id) => evidenceIds.has(id)));
  paper.story = undefined;
  paper.studyProfile = undefined;
  paper.pendingEvidenceFigureIds = paper.pendingEvidenceFigureIds.filter((id) =>
    paper.figures.some((figure) => figure.id === id),
  );
}
/** 单元结果只替换其拥有的对象，事务提交方再记录 inputKey 和完成时间。 */
export function applyUnitResult(paper: Paper, input: { stage: Stage; target: Target; result: unknown }): Paper {
  const next = structuredClone(paper);
  const { stage, target } = input;
  if (target.kind === 'paper') {
    const result = input.result as EvidenceResult;
    next.metadata = { ...next.metadata, ...result.metadata };
    next.studyProfile = result.studyProfile;
    next.story = result.story;
    next.pendingEvidenceFigureIds = [];
    if (
      getAnalysisProgress(next).figuresReady &&
      next.pages.every((page) => unitComplete(next, 'evidence', { kind: 'page', ...page }))
    )
      for (const selection of next.figurePageSelections)
        if (!isSelected(selection)) selection.processedRevision = selection.revision;
    return validatePaper(next);
  }
  if (target.kind !== 'page') throw new PaperAnalysisError('invalid-target', '本阶段需要明确原文件与页码。');
  const match = (item: { documentId: string; pageNumber: number }) =>
    item.documentId === target.documentId && item.pageNumber === target.pageNumber;
  if (stage === 'text') {
    const result = input.result as TextResult;
    const doc = next.documents.find((item) => item.id === target.documentId)!;
    doc.pageCount = result.pageCount;
    if (doc.role === 'primary' && result.metadataTitle) next.metadata.title = result.metadataTitle;
    next.blocks = next.blocks.filter((item) => !match(item));
    const blocks = result.blocks.map((block) => ({
      ...block,
      documentId: target.documentId,
      pageNumber: target.pageNumber,
    }));
    next.blocks.push(...blocks);
    next.pages = next.pages.filter((item) => !match(item));
    next.pages.push({
      documentId: target.documentId,
      pageNumber: target.pageNumber,
      width: result.width,
      height: result.height,
      blockIds: blocks.map((block) => block.id),
    });
    next.pages.sort(
      (a, b) =>
        next.documents.findIndex((doc) => doc.id === a.documentId) -
          next.documents.findIndex((doc) => doc.id === b.documentId) || a.pageNumber - b.pageNumber,
    );
    next.sources = next.sources.filter((item) => !match(item) || !item.textSpan);
    for (const block of blocks) {
      if (!block.text) continue;
      // 每个句子保留精确原文偏移；换行和科学符号不经模型重写。
      const sentences = [...block.text.matchAll(/[^。！？.!?]+[。！？.!?]*(?:\s+|$)|[\s\S]+/g)];
      for (const sentence of sentences) {
        const start = sentence.index!;
        const end = start + sentence[0].length;
        if (!sentence[0].trim()) continue;
        next.sources.push({
          id: `${block.id}:span:${start}`,
          documentId: block.documentId,
          pageNumber: block.pageNumber,
          kind: block.kind === 'caption' ? 'caption' : 'text',
          textSpan: { blockId: block.id, start, end },
          textQuote: block.text.slice(start, end),
        });
      }
    }
    if (!next.figurePageSelections.some(match))
      next.figurePageSelections.push({
        documentId: target.documentId,
        pageNumber: target.pageNumber,
        automatic: 'pending',
        revision: 1,
      });
  } else if (stage === 'figure-discovery') {
    const selection = next.figurePageSelections.find(match)!;
    const automatic = (input.result as { automatic: 'detected' | 'not-detected' }).automatic;
    if (selection.automatic !== automatic) selection.revision++;
    selection.automatic = automatic;
    if (!isSelected(selection)) selection.processedRevision = selection.revision;
  } else if (stage === 'figure-location' || stage === 'panel-analysis') {
    const result = input.result as FigureResult;
    const selection = next.figurePageSelections.find(match)!;
    if (!isSelected(selection)) throw new PaperAnalysisError('stale-selection', '该页已取消图源处理，旧结果未保存。');
    // 已有人工来源只由手动图源用例调整，自动单元不覆盖。
    if (next.sources.some((source) => match(source) && source.geometryOrigin === 'manual'))
      throw new PaperAnalysisError('manual-source', '该页包含人工图源，请在核对页处理。');
    const old = new Set(
      next.sources
        .filter((source) => match(source) && ['figure', 'panel'].includes(source.kind))
        .map((source) => source.id),
    );
    next.sources = next.sources.filter((source) => !old.has(source.id));
    next.figures = next.figures
      .map((figure) => ({ ...figure, regions: figure.regions.filter((region) => !old.has(region.sourceId)) }))
      .filter((figure) => figure.regions.length);
    next.sources.push(...result.sources);
    for (const figure of result.figures) {
      const existing = next.figures.find((item) => item.id === figure.id);
      if (existing) existing.regions.push(...figure.regions);
      else next.figures.push(figure);
    }
    invalidateRemovedSources(next, new Set([...old].filter((id) => !next.sources.some((source) => source.id === id))));
    selection.processedRevision = selection.revision;
    next.figureReview = {
      ...next.figureReview,
      revision: next.figureReview.revision + 1,
      confirmedRevision: undefined,
      confirmedAt: undefined,
    };
  } else if (stage === 'evidence') {
    const result = input.result as EvidenceResult;
    const prefix = `finding:${pageKey(target.documentId, target.pageNumber)}:`;
    next.claims = [...next.claims.filter((claim) => !claim.id.startsWith(prefix)), ...result.claims];
    next.evidences = [...next.evidences.filter((evidence) => !evidence.id.startsWith(prefix)), ...result.evidences];
    next.story = undefined;
    next.studyProfile = undefined;
  }
  return validatePaper(next);
}

export function selectionImpact(paper: Paper, documentId: string, pageNumber: number) {
  const sourceIds = paper.sources
    .filter(
      (source) =>
        source.documentId === documentId &&
        source.pageNumber === pageNumber &&
        ['figure', 'panel'].includes(source.kind),
    )
    .map((source) => source.id);
  return {
    sourceIds,
    figureIds: paper.figures
      .filter((figure) => figure.regions.some((region) => sourceIds.includes(region.sourceId)))
      .map((figure) => figure.id),
    evidenceIds: paper.evidences
      .filter((evidence) => evidence.sourceIds.some((id) => sourceIds.includes(id)))
      .map((item) => item.id),
  };
}
export function applyPageSelection(
  paper: Paper,
  input: {
    documentId: string;
    pageNumber: number;
    manualOverride?: 'include' | 'exclude';
    expectedRevision: number;
    confirmRemoval?: boolean;
  },
) {
  const next = structuredClone(paper);
  const selection = next.figurePageSelections.find(
    (page) => page.documentId === input.documentId && page.pageNumber === input.pageNumber,
  );
  if (!selection || selection.revision !== input.expectedRevision)
    throw new PaperAnalysisError('stale-selection', '页面选择已变化，请刷新后重试。');
  if (selection.manualOverride === input.manualOverride) return paper;
  const impact = selectionImpact(next, input.documentId, input.pageNumber);
  const willSelect =
    input.manualOverride === 'include' || (input.manualOverride !== 'exclude' && selection.automatic === 'detected');
  if (!willSelect && impact.sourceIds.length && !input.confirmRemoval)
    throw new PaperAnalysisError('removal-confirmation', '该页已有图源，请核对影响并确认移除。');
  selection.manualOverride = input.manualOverride;
  selection.revision++;
  if (!willSelect && !impact.sourceIds.length) selection.processedRevision = selection.revision;
  if (!willSelect && impact.sourceIds.length) {
    const removed = new Set(impact.sourceIds);
    next.sources = next.sources.filter((source) => !removed.has(source.id));
    next.figures = next.figures
      .map((figure) => ({ ...figure, regions: figure.regions.filter((region) => !removed.has(region.sourceId)) }))
      .filter((figure) => figure.regions.length);
    invalidateRemovedSources(next, removed);
  }
  next.figureReview = {
    ...next.figureReview,
    revision: next.figureReview.revision + 1,
    confirmedRevision: undefined,
    confirmedAt: undefined,
  };
  return validatePaper(next);
}
