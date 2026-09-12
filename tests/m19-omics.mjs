import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const reviewed = process.env.SMARTJC_OMICS_REVIEW === '1';
const prefix = reviewed ? 'output/playwright/m19-omics-final' : 'output/playwright/m19-omics-current';
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/';
const prior = JSON.parse(await readFile('output/playwright/m18-real-edited.json', 'utf8'));
const pdf = (await readFile('test-fixtures/papers/omics-torc1-proteomics.pdf')).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('https://api.deepseek.com/**', () => {
    throw Error('M19 omics must reuse saved evidence without model calls');
  });
  await page.goto(base);
  const data = await page.evaluate(
    async ({ prior, pdf }) => {
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const { slidesStore } = await import('/src/app/composition.ts');
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'omics-torc1-proteomics.pdf'),
      });
      const paper = {
        ...prior.paper,
        id: created.paper.id,
        projectId: created.project.id,
        documents: prior.paper.documents.map((d, i) => ({ ...d, pdfAssetId: created.paper.documents[i].pdfAssetId })),
      };
      const deck = { ...prior.deck, paperId: paper.id };
      await transaction(['projects', 'papers', 'decks'], 'readwrite', async (tx) => {
        tx.objectStore('projects').put(
          { ...created.project, currentDeckId: deck.id, checkpoint: 'deck-ready', lastOpenedStep: 'slides' },
          created.project.id,
        );
        tx.objectStore('papers').put(paper, paper.id);
        tx.objectStore('decks').put(deck, deck.id);
      });
      const saved = await slidesStore.open(created.project.id);
      const { checkPresentation } = await import('/src/app/presentation/checkPresentation.ts');
      return {
        project: saved.project,
        paper: saved.paper,
        deck: saved.current,
        check: checkPresentation(saved.current, saved.paper, true),
      };
    },
    { prior, pdf },
  );
  assert.equal(data.check.errors.length, 0, JSON.stringify(data.check.errors));
  assert.deepEqual(data.deck.speech, prior.deck.speech);
  assert.deepEqual(data.deck.slides, prior.deck.slides);
  assert.deepEqual(data.paper.sources, prior.paper.sources);
  if (reviewed) {
    Object.assign(data, await (await import('./m19-omics-crops.mjs')).correctOmicsCrops(page, data.project.id));
    assert.equal(data.check.errors.length, 0, JSON.stringify(data.check.errors));
    Object.assign(
      data,
      await page.evaluate(async (projectId) => {
        const { slidesService } = await import('/src/app/composition.ts');
        const state = await slidesService.open(projectId),
          session = slidesService.session(state);
        const segment = state.current.speech.find((s) => s.id === '5a67b4c1-3f63-4010-a23d-f348e5fd6179');
        const slide = state.current.slides[62];
        if (!segment.text.includes('135 分钟') || !slide.message.includes('135'))
          throw Error('Reviewed timing changed');
        const text = segment.text.replace(
          '135 分钟',
          '135 分钟（图注为 135 分钟，而 Fig 4A 时间轴标为 150 分钟，原文存在差异）',
        );
        const message = slide.message + ' 图注写 135 分钟，图中时间轴标为 150 分钟，原文不一致。';
        await session.commit(
          { type: 'deck' },
          [
            { type: 'edit-speech', segmentId: segment.id, text },
            { type: 'update-slide', slideId: slide.id, changes: { message } },
          ],
          '标明 Fig 4A 时间轴与图注的采样时间差异',
        );
        const saved = await slidesService.open(projectId);
        const { checkPresentation } = await import('/src/app/presentation/checkPresentation.ts');
        return {
          project: saved.project,
          paper: saved.paper,
          deck: saved.current,
          check: checkPresentation(saved.current, saved.paper, true),
          timingCorrection: { slide: 63, before: segment.text, after: text },
        };
      }, data.project.id),
    );
    assert.equal(data.check.errors.length, 0, JSON.stringify(data.check.errors));
  }
  await writeFile(prefix + '.json', JSON.stringify(data, null, 2));
  await page.goto(base + '#/project/' + data.project.id);
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs(prefix + '.pptx');
  await page.screenshot({ path: prefix + '.jpg', type: 'jpeg', quality: 80 });
  console.log(
    JSON.stringify({
      pass: true,
      reviewed,
      editedImages: data.edits?.length,
      editedSlides: new Set(data.edits?.map((e) => e.slide)).size,
      models: 0,
    }),
  );
} finally {
  await browser.close();
}
