import { z } from 'zod';
import { containsBBox } from '../../shared/schema';
import {
  MetadataSchema,
  PaperDocumentSchema,
  PaperPageSchema,
  SourceReferenceSchema,
  TextBlockSchema,
} from './document';
import { ClaimSchema, EvidenceSchema, StorySchema, StudyProfileSchema } from './evidence';
import { FigurePageSelectionSchema, type FigurePanelSchema, FigureRefSchema, FigureReviewSchema } from './figures';

export { PaperDocumentSchema, SourceReferenceSchema, TextBlockSchema } from './document';
export { FigurePageSelectionSchema, FigurePanelSchema, FigureRefSchema } from './figures';

const identity = z.string().min(1);
const pageNumber = z.number().int().positive();
export const AnalysisStages = ['text', 'figure-discovery', 'figure-location', 'panel-analysis', 'evidence'] as const;
export const AnalysisUnitTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page'), documentId: identity, pageNumber }),
  z.strictObject({ kind: z.literal('region'), figureId: identity, regionId: identity }),
  z.strictObject({ kind: z.literal('paper') }),
]);
export const PaperSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: identity,
  projectId: identity,
  revision: z.number().int().nonnegative(),
  documents: z.array(PaperDocumentSchema).min(1).max(2),
  metadata: MetadataSchema,
  pages: z.array(PaperPageSchema),
  blocks: z.array(TextBlockSchema),
  figurePageSelections: z.array(FigurePageSelectionSchema),
  analysisUnits: z.array(
    z.strictObject({
      id: identity,
      stage: z.enum(AnalysisStages),
      target: AnalysisUnitTargetSchema,
      inputKey: identity,
      outcome: z.enum(['completed', 'no-figure-located']),
      completedAt: z.number().int().nonnegative(),
    }),
  ),
  sources: z.array(SourceReferenceSchema),
  figures: z.array(FigureRefSchema),
  figureReview: FigureReviewSchema,
  pendingEvidenceFigureIds: z.array(identity),
  studyProfile: StudyProfileSchema.optional(),
  story: StorySchema.optional(),
  claims: z.array(ClaimSchema),
  evidences: z.array(EvidenceSchema),
});
export type Paper = z.infer<typeof PaperSchema>;
export type PaperDocument = z.infer<typeof PaperDocumentSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type FigureRef = z.infer<typeof FigureRefSchema>;
export type FigurePanel = z.infer<typeof FigurePanelSchema>;
export type FigurePageSelection = z.infer<typeof FigurePageSelectionSchema>;
export type AnalysisUnitTarget = z.infer<typeof AnalysisUnitTargetSchema>;
export type AnalysisStage = (typeof AnalysisStages)[number];
export type AnalysisUnitRecord = Paper['analysisUnits'][number];

export class PaperError extends Error {
  readonly stage = 'paper-analysis';
  readonly recovery = '保留已保存成果，重新打开项目后继续未完成部分。';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const pageKey = (documentId: string, page: number) => `${documentId}:${page}`;
export const isPageSelected = (selection: FigurePageSelection) =>
  selection.manualOverride ? selection.manualOverride === 'include' : selection.automatic === 'detected';

/** 检查聚合内身份、原文区间与图源引用；失败时调用方不得保存部分结果。 */
export function validatePaper(value: unknown): Paper {
  const paper = PaperSchema.parse(value);
  const fail = (message: string): never => {
    throw new PaperError('invalid-reference', message);
  };
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) fail('论文包含重复身份');
  };
  for (const items of [
    paper.documents,
    paper.blocks,
    paper.sources,
    paper.figures,
    paper.claims,
    paper.evidences,
    paper.analysisUnits,
  ])
    unique(items.map((item) => item.id));
  if (
    paper.documents.filter((item) => item.role === 'primary').length !== 1 ||
    paper.documents.filter((item) => item.role === 'supplement').length > 1
  )
    fail('项目必须包含一份主论文及至多一份补充材料');
  unique(paper.documents.map((item) => item.pdfAssetId));
  const documents = new Set(paper.documents.map((item) => item.id));
  const pages = new Set(paper.pages.map((item) => pageKey(item.documentId, item.pageNumber)));
  unique([...paper.pages.map((item) => pageKey(item.documentId, item.pageNumber))]);
  const blocks = new Map(paper.blocks.map((item) => [item.id, item]));
  const sources = new Map(paper.sources.map((item) => [item.id, item]));
  for (const page of paper.pages) {
    if (!documents.has(page.documentId)) fail('页面不属于本论文文件');
    const document = paper.documents.find((item) => item.id === page.documentId)!;
    if (document.pageCount !== undefined && page.pageNumber > document.pageCount) fail('页码超出文件总页数');
    unique(page.blockIds);
    for (const id of page.blockIds) {
      const block = blocks.get(id);
      if (!block || block.documentId !== page.documentId || block.pageNumber !== page.pageNumber)
        fail('原文块与页面关联不一致');
    }
  }
  for (const block of paper.blocks)
    if (
      !pages.has(pageKey(block.documentId, block.pageNumber)) ||
      !paper.pages.some((page) => page.blockIds.includes(block.id))
    )
      fail('原文块缺少所属页面');
  unique(paper.figurePageSelections.map((item) => pageKey(item.documentId, item.pageNumber)));
  for (const selection of paper.figurePageSelections)
    if (
      !pages.has(pageKey(selection.documentId, selection.pageNumber)) ||
      (selection.processedRevision ?? 0) > selection.revision
    )
      fail('图源页选择版本或归属无效');
  for (const source of paper.sources) {
    if (!pages.has(pageKey(source.documentId, source.pageNumber))) fail('来源不属于本论文页面');
    if ((source.kind === 'figure' || source.kind === 'panel') && !source.bbox) fail('图源缺少原页矩形');
    if (source.textSpan) {
      const block = blocks.get(source.textSpan.blockId);
      if (
        !block ||
        block.documentId !== source.documentId ||
        block.pageNumber !== source.pageNumber ||
        source.textSpan.start >= source.textSpan.end ||
        source.textSpan.end > block.text.length
      )
        fail('原句定位区间无效');
      if (
        block &&
        source.textQuote !== undefined &&
        source.textQuote !== block.text.slice(source.textSpan.start, source.textSpan.end)
      )
        fail('原句引用与全文不一致');
    }
  }
  unique(paper.figures.flatMap((figure) => figure.regions.map((region) => region.id)));
  unique(paper.figures.flatMap((figure) => figure.regions.flatMap((region) => region.panels.map((panel) => panel.id))));
  const checkSources = (ids: string[]) => {
    for (const id of ids) if (!sources.has(id)) fail('证据或图注引用不存在的来源');
  };
  for (const figure of paper.figures) {
    checkSources(figure.captionSourceIds ?? []);
    for (const region of figure.regions) {
      const source = sources.get(region.sourceId);
      if (!source?.bbox) fail('图块来源无效');
      for (const panel of region.panels) {
        const panelSource = sources.get(panel.sourceId);
        if (
          !panelSource?.bbox ||
          panelSource.documentId !== source?.documentId ||
          panelSource.pageNumber !== source.pageNumber
        )
          fail('Panel 必须与所属图块同文件同页');
        if (source?.bbox && panelSource?.bbox && !containsBBox(source.bbox, panelSource.bbox))
          fail('Panel 超出所属图块范围');
        checkSources(panel.captionAssociation?.links.map((link) => link.sourceId) ?? []);
      }
    }
  }
  const evidenceIds = new Set(paper.evidences.map((item) => item.id));
  const claimIds = new Set(paper.claims.map((item) => item.id));
  for (const evidence of paper.evidences) checkSources(evidence.sourceIds);
  for (const claim of paper.claims)
    for (const id of claim.evidenceIds) if (!evidenceIds.has(id)) fail('发现引用不存在的证据');
  checkSources(paper.studyProfile?.sourceIds ?? []);
  for (const points of Object.values(paper.story ?? {}))
    for (const point of points) {
      checkSources(point.sourceIds);
      for (const id of point.claimIds) if (!claimIds.has(id)) fail('故事点引用不存在的发现');
    }
  const review = paper.figureReview;
  if (
    (review.confirmedRevision === undefined) !== (review.confirmedAt === undefined) ||
    (review.confirmedRevision !== undefined && review.confirmedRevision !== review.revision)
  )
    fail('图源核对确认版本无效');
  for (const unit of paper.analysisUnits) {
    if (unit.outcome === 'no-figure-located' && unit.stage !== 'figure-location') fail('无图定位结果所属阶段无效');
    if (unit.target.kind === 'page' && !pages.has(pageKey(unit.target.documentId, unit.target.pageNumber)))
      fail('完整分析单元引用不存在的页');
    if (unit.target.kind === 'region') {
      const target = unit.target;
      if (
        !paper.figures.some(
          (figure) => figure.id === target.figureId && figure.regions.some((region) => region.id === target.regionId),
        )
      )
        fail('完整分析单元引用不存在的图块');
    }
  }
  for (const id of paper.pendingEvidenceFigureIds)
    if (!paper.figures.some((figure) => figure.id === id)) fail('待刷新关联引用不存在的 Figure');
  return paper;
}
