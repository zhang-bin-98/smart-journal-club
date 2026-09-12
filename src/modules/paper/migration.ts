import { type Paper, validatePaper } from './model';
import { type Paper as LegacyPaper, PaperSchema as LegacyPaperSchema } from './paper.schema';

/** 由已有身份稳定派生，迁移失败重试与旧稿共享文件保持相同映射。 */
export function migratePaperV1(value: unknown, project: { id: string; pdfAssetId: string }, fileName: string): Paper {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2)
    return validatePaper(value);
  const old = LegacyPaperSchema.parse(value);
  const documentId = `document:${project.pdfAssetId}`;
  const blocks = old.pages.map((page) => ({
    id: `block:${documentId}:${page.pageNumber}`,
    documentId,
    pageNumber: page.pageNumber,
    kind: 'other' as const,
    text: page.text,
  }));
  return validatePaper({
    ...old,
    schemaVersion: 2,
    projectId: project.id,
    revision: 0,
    documents: [
      {
        id: documentId,
        role: 'primary',
        fileName,
        pdfAssetId: project.pdfAssetId,
      },
    ],
    pages: old.pages.map(({ text: _text, ...page }, index) => ({ ...page, documentId, blockIds: [blocks[index].id] })),
    blocks,
    sources: old.sources.map((source) => ({ ...source, documentId })),
    figures: old.figures.map(({ sourceId, panels, ...figure }) => ({
      ...figure,
      regions: [{ id: `region:${figure.id}:${sourceId}`, sourceId, panels }],
    })),
    figurePageSelections: old.pages.map((page) => ({
      documentId,
      pageNumber: page.pageNumber,
      automatic: old.sources.some(
        (source) => source.pageNumber === page.pageNumber && (source.kind === 'figure' || source.kind === 'panel'),
      )
        ? 'detected'
        : 'pending',
      revision: 1,
    })),
    analysisUnits: [],
    figureReview: { revision: 0 },
    pendingEvidenceFigureIds: [],
  });
}

/** 旧幻灯片功能的只读投影；调用方禁止将投影写回底稿。 */
export function toLegacyPaper(paper: Paper): LegacyPaper {
  return LegacyPaperSchema.parse({
    schemaVersion: 1,
    id: paper.id,
    metadata: paper.metadata,
    pages: paper.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      text: page.blockIds.map((id) => paper.blocks.find((block) => block.id === id)?.text ?? '').join('\n\n'),
    })),
    sources: paper.sources.map(
      ({ documentId: _document, textSpan: _span, geometryOrigin: _origin, ...source }) => source,
    ),
    figures: paper.figures.map(({ regions, captionSourceIds: _captions, ...figure }) => ({
      ...figure,
      sourceId: regions[0].sourceId,
      panels: regions.flatMap((region) => region.panels),
    })),
    claims: paper.claims,
    evidences: paper.evidences,
    studyProfile: paper.studyProfile,
    story: paper.story,
  });
}
