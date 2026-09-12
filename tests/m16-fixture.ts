import { fixturePaper } from './fixtures';
import { legacyProject } from './legacy-fixtures';
import { migratePaperV1 } from '../src/modules/paper/migration';
import { getUnitInputKey, unitId } from '../src/modules/paper/analysisUnits';
import { createProject } from '../src/infrastructure/persistence/projectStore';
import { transaction } from '../src/infrastructure/persistence/indexedDb';
export async function createM16Fixture(blob: Blob) {
  const data = await createProject({
    primary: new File([blob], 'main.pdf', { type: 'application/pdf' }),
    supplement: new File([blob], 'supplement.pdf', { type: 'application/pdf' }),
  });
  const legacy = legacyProject({
    id: data.project.id,
    paperId: data.paper.id,
    pdfAssetId: data.paper.documents[0].pdfAssetId,
    checkpoint: 'paper-ready',
  });
  const paper = migratePaperV1(fixturePaper, legacy, 'main.pdf');
  paper.id = data.paper.id;
  paper.projectId = data.project.id;
  const oldDocument = paper.documents[0].id;
  paper.documents = data.paper.documents.map((doc) => ({ ...doc, pageCount: 1 }));
  const primary = paper.documents[0].id;
  for (const entries of [paper.pages, paper.blocks, paper.sources, paper.figurePageSelections])
    for (const item of entries) if (item.documentId === oldDocument) item.documentId = primary;
  const region = paper.figures[0].regions[0];
  const oldSource = paper.sources.find((source) => source.id === region.sourceId)!;
  const regionSource = {
    ...oldSource,
    id: 'm16-region-source',
    kind: 'figure' as const,
    bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    geometryOrigin: 'automatic' as const,
  };
  region.sourceId = regionSource.id;
  paper.sources.push(regionSource);
  const supplement = paper.documents[1].id;
  paper.pages.push({ documentId: supplement, pageNumber: 1, width: 600, height: 800, blockIds: ['supplement-text'] });
  paper.blocks.push({
    id: 'supplement-text',
    documentId: supplement,
    pageNumber: 1,
    kind: 'paragraph',
    text: 'Independent supplement source.',
  });
  paper.figurePageSelections.push({
    documentId: supplement,
    pageNumber: 1,
    automatic: 'not-detected',
    revision: 1,
    processedRevision: 1,
  });
  paper.figureReview.automaticBaseline = {
    figures: structuredClone(paper.figures),
    sources: structuredClone(paper.sources),
  };
  const make = (
    stage: 'text' | 'figure-discovery' | 'figure-location' | 'evidence',
    target: { kind: 'page'; documentId: string; pageNumber: number } | { kind: 'paper' },
  ) => ({
    id: unitId(stage, target),
    stage,
    target,
    inputKey: getUnitInputKey(paper, stage, target),
    outcome: 'completed' as const,
    completedAt: 1,
  });
  paper.analysisUnits = paper.pages.flatMap((page) => {
    const target = { kind: 'page' as const, documentId: page.documentId, pageNumber: page.pageNumber };
    return ['text', 'figure-discovery', ...(page.documentId === primary ? ['figure-location'] : []), 'evidence'].map(
      (stage) => make(stage as 'text', target),
    );
  });
  paper.analysisUnits.push(make('evidence', { kind: 'paper' }));
  const project = { ...data.project, lastOpenedStep: 'figure-review' as const, checkpoint: 'paper-ready' as const };
  await transaction(['papers', 'projects'], 'readwrite', async (tx) => {
    tx.objectStore('papers').put(paper, paper.id);
    tx.objectStore('projects').put(project, project.id);
  });
  return project.id;
}
