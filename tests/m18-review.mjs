import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const original = JSON.parse(await readFile('output/playwright/m18-real-presentation.json', 'utf8')).result;
const pdf = (await readFile('test-fixtures/papers/omics-torc1-proteomics.pdf')).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5178/';
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let requests = 0;
  await page.route('https://api.deepseek.com/**', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto(base);
  const id = await page.evaluate(
    async ({ original, pdf }) => {
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'omics-torc1-proteomics.pdf', {
          type: 'application/pdf',
        }),
        preferences: original.project.preferences,
      });
      const paper = {
        ...original.paper,
        id: created.paper.id,
        projectId: created.project.id,
        documents: original.paper.documents.map((d, i) => ({
          ...d,
          pdfAssetId: created.paper.documents[i].pdfAssetId,
        })),
      };
      const deck = { ...original.deck, paperId: paper.id };
      await transaction(['projects', 'papers', 'decks'], 'readwrite', async (tx) => {
        tx.objectStore('papers').put(paper, paper.id);
        tx.objectStore('decks').put(deck, deck.id);
        tx.objectStore('projects').put(
          { ...created.project, currentDeckId: deck.id, lastOpenedStep: 'slides', checkpoint: 'deck-ready' },
          created.project.id,
        );
      });
      return created.project.id;
    },
    { original, pdf },
  );
  await page.goto(`${base}#/project/${id}`);
  await page.reload();
  await page.getByRole('button', { name: '专注当前页', exact: true }).click();
  await page.getByRole('textbox', { name: '幻灯片标题', exact: true }).fill('营养饥饿通常伴随 TORC1 失活');
  await page.getByRole('textbox', { name: '幻灯片标题', exact: true }).press('Tab');
  const edits = [];
  for (const [number, figureIndex, handle, steps] of [[75, 1, 'w', 9]]) {
    await page.getByRole('button', { name: `打开第 ${number} 页`, exact: true }).click();
    const element = original.deck.slides[number - 1].elements.filter((e) => e.type === 'figure')[figureIndex];
    await page.locator(`[data-slide-preview="current"] [data-element-id="${element.id}"] button`).click();
    await page.getByRole('button', { name: '本页裁图', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '本页裁图', exact: true });
    await page.waitForFunction(
      () => document.querySelector('[role="dialog"] [role="application"]')?.getAttribute('aria-busy') === 'false',
    );
    const boundary = dialog.getByRole('button', { name: `调整${handle}边界`, exact: true });
    for (let index = 0; index < steps; index++) await boundary.press('Shift+ArrowLeft');
    await dialog.screenshot({ path: `output/playwright/m18-real-crop-${number}.jpg`, type: 'jpeg', quality: 80 });
    await dialog.getByRole('button', { name: '保存本页裁图', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    edits.push({ slide: number, elementId: element.id, handle, steps });
  }
  const state = await page.evaluate(
    async (id) => await (await import('/src/app/composition.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(state.paper.revision, original.paper.revision);
  assert.deepEqual(state.paper.figures, original.paper.figures);
  assert.deepEqual(state.current.speech, original.deck.speech);
  assert.equal(state.current.revision, 2);
  assert.equal(requests, 0);
  await writeFile(
    'output/playwright/m18-real-edited.json',
    JSON.stringify({ deck: state.current, paper: state.paper, edits }, null, 2),
  );
  await page.screenshot({ path: 'output/playwright/m18-real-edited-workspace.jpg', type: 'jpeg', quality: 80 });
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs('output/playwright/m18-real-edited.pptx');
  await page.reload();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  const reopened = await page.evaluate(
    async (id) => await (await import('/src/app/composition.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(reopened.project.lastOpenedSlideId, original.deck.slides[74].id);
  assert.deepEqual(reopened.current, state.current);
  console.log('M18 real review: two page edits saved, paper unchanged, reopen retained selection, zero model calls.');
} catch (error) {
  if (page) await page.screenshot({ path: 'output/playwright/m18-review-failure.jpg', type: 'jpeg' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
