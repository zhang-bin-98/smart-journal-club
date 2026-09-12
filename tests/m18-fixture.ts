import { createM16Fixture } from './m16-fixture';
import { speechFixture } from './speech-fixture';
import { get, transaction } from '../src/shared/persistence/indexedDb';
import { openProject, openStep } from '../src/infrastructure/persistence/projectStore';
import { speechStore } from '../src/infrastructure/persistence/speechStore';
import { SpeechPlanSchema } from '../src/modules/presentation/planning';
import type { Paper } from '../src/modules/paper/model';
export async function createM18Fixture(blob: Blob) {
  const id = await createM16Fixture(blob);
  const dataBefore = await openProject(id);
  const { PdfResource } = await import('../src/infrastructure/pdf/pdfResource');
  const resource = new PdfResource(blob);
  const pdf = await resource.getDocument();
  const pdfPage = await pdf.getPage(1);
  const viewport = pdfPage.getViewport({ scale: 1 });
  await resource.dispose();
  await transaction(['papers'], 'readwrite', async (tx) => {
    const data = dataBefore;
    const paper = (await get<Paper>(tx, 'papers', data.paper.id))!;
    for (const page of paper.pages) {
      page.width = viewport.width;
      page.height = viewport.height;
    }
    paper.figureReview.confirmedRevision = paper.figureReview.revision;
    paper.figureReview.confirmedAt = 1;
    const figure = paper.figures[0];
    const region = figure.regions[0];
    const base = paper.sources.find((s) => s.id === region.panels[0].sourceId)!;
    for (const [index, label] of ['B', 'C'].entries()) {
      const source = {
        ...base,
        id: 'm18-source-' + label,
        documentId: index === 1 ? paper.documents[1].id : base.documentId,
        bbox: { x: 0.1, y: 0.1, width: index === 0 ? 0.7 : 0.25, height: index === 0 ? 0.25 : 0.75 },
      };
      paper.sources.push(source);
      if (index === 0) region.panels.push({ id: 'm18-panel-' + label, label, sourceId: source.id });
      else figure.regions.push({ id: 'm18-supplement-region', sourceId: source.id, panels: [] });
    }
    tx.objectStore('papers').put(paper, paper.id);
  });
  const data = await speechStore.open(id);
  const content = speechFixture().target!.content;
  content.speech[0].sourceIds = data.paper.sources.map((s) => s.id);
  content.speech[0].claimIds = data.paper.claims.map((c) => c.id);
  content.speech[1].sourceIds = [data.paper.sources[0].id];
  const now = Date.now();
  await speechStore.saveGenerated({
    record: {
      recordVersion: 2,
      projectId: id,
      stage: 'outline-ready',
      mode: 'initial',
      base: data.base,
      generationPreferences: data.project.preferences,
      plan: SpeechPlanSchema.parse({
        ...content,
        schemaVersion: 3,
        id: 'm18-plan-' + id,
        paperId: data.paper.id,
        paperRevision: data.paper.revision,
        revision: 0,
        status: 'draft',
        slides: [],
        createdAt: now,
        updatedAt: now,
      }),
    },
    expectedPlan: data.planKey,
    signal: new AbortController().signal,
    assertActive() {},
  });
  await openStep(id, 'outline-speech');
  return id;
}
