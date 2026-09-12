import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = process.env.SMARTJC_PUBLIC_SAMPLE;
if (!['clinical-vrc07-phase1-trial', 'mechanism-modt-cdifficile'].includes(name)) throw Error('Unknown public sample');
const prefix = 'output/playwright/m19-' + name;
const prior = JSON.parse(await readFile(prefix + '-edited.json', 'utf8')).result;
const pdf = (await readFile('test-fixtures/papers/' + name + '.pdf')).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://api.deepseek.com/**', () => {
    throw Error('Export must not call models');
  });
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const state = await page.evaluate(
    async ({ prior, pdf, name }) => {
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const { slidesStore } = await import('/src/app/composition.ts');
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], name + '.pdf'),
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
      const state = await slidesStore.open(created.project.id);
      if (
        JSON.stringify(state.current.slides) !== JSON.stringify(prior.deck.slides) ||
        JSON.stringify(state.current.speech) !== JSON.stringify(prior.deck.speech) ||
        JSON.stringify(state.paper.sources) !== JSON.stringify(prior.paper.sources)
      )
        throw Error('Saved content changed');
      return { project: state.project, paper: state.paper, deck: state.current };
    },
    { prior, pdf, name },
  );
  await page.goto((process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/') + '#/project/' + state.project.id);
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs(prefix + '-edited.pptx');
  await writeFile(prefix + '-isolated-export.json', JSON.stringify(state, null, 2));
  console.log('PASS: same saved deck/source/speech exported in isolated browser, zero model calls');
} finally {
  await browser.close();
}
