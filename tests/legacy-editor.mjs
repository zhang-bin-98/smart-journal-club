import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The same historical Deck fixture now exercises the production workspace and real storage. */
export async function checkLegacyEditor(page, base, output) {
  await page.goto(base);
  const pdf = (await readFile('test-fixtures/papers/clinical-vrc07-phase1-trial.pdf')).toString('base64');
  const id = await page.evaluate(async (pdf) => {
    const { fixturePaper } = await import('/tests/fixtures.ts');
    const { narrativeDeck } = await import('/tests/narrative-fixture.ts');
    const fixtureDeck = narrativeDeck();
    const { legacyProject } = await import('/tests/legacy-fixtures.ts');
    const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
    const id = crypto.randomUUID();
    const paper = { ...structuredClone(fixturePaper), id: crypto.randomUUID() };
    const deck = { ...structuredClone(fixtureDeck), id: crypto.randomUUID(), paperId: paper.id };
    const project = legacyProject({
      id,
      paperId: paper.id,
      currentDeckId: deck.id,
      pdfAssetId: crypto.randomUUID(),
      checkpoint: 'deck-ready',
    });
    await transaction(['projects', 'papers', 'decks', 'assets'], 'readwrite', async (tx) => {
      tx.objectStore('projects').put(project, id);
      tx.objectStore('papers').put(paper, paper.id);
      tx.objectStore('decks').put(deck, deck.id);
      tx.objectStore('assets').put(
        {
          id: project.pdfAssetId,
          name: 'legacy.pdf',
          blob: new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }),
        },
        project.pdfAssetId,
      );
    });
    return id;
  }, pdf);
  const read = () => page.evaluate(async (id) => (await import('/src/app/composition.ts')).slidesStore.open(id), id);
  const waitFor = async (predicate, argument) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await page.evaluate(predicate, argument)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`等待当前稿提交失败：${(await page.getByRole('alert').allTextContents()).join('；')}`);
  };
  await page.goto(`${base}#/project/${id}`);
  const initial = (await read()).current;
  const title = page.getByRole('textbox', { name: '幻灯片标题', exact: true }).first();
  await title.fill('中文草稿');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionstart', { data: '' });
  await title.fill('中文组合输入');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionend', { data: '输入' });
  await title.press('Tab');
  await page.getByRole('button', { name: '打开第 2 页', exact: true }).click();
  await page.getByRole('button', { name: '打开第 1 页', exact: true }).click();
  assert.equal(await title.innerText(), '中文组合输入');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await waitFor(
    (expected) => document.querySelector('[aria-label="幻灯片标题"]')?.textContent === expected,
    initial.slides[0].title,
  );
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await waitFor(() => document.querySelector('[aria-label="幻灯片标题"]')?.textContent === '中文组合输入');
  await page.getByRole('button', { name: '下移', exact: true }).click();
  await waitFor(
    async ({ id, first }) =>
      (await (await import('/src/app/composition.ts')).slidesStore.open(id)).current.slides[1].id === first,
    { id, first: initial.slides[0].id },
  );
  assert.deepEqual(
    (await read()).current.slides.map((s) => s.id),
    [initial.slides[1].id, initial.slides[0].id, ...initial.slides.slice(2).map((s) => s.id)],
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await waitFor(
    async ({ id, first }) =>
      (await (await import('/src/app/composition.ts')).slidesStore.open(id)).current.slides[0].id === first,
    { id, first: initial.slides[0].id },
  );
  const figureIndex = initial.slides.findIndex((s) => s.elements.some((e) => e.type === 'figure'));
  const figureId = initial.slides[figureIndex].elements.find((e) => e.type === 'figure').id;
  await page.getByRole('button', { name: `打开第 ${figureIndex + 1} 页`, exact: true }).click();
  await page.locator('[data-slide-preview="current"] [aria-label="选择 Figure"]').first().click();
  await page.getByRole('button', { name: '删除元素', exact: true }).click();
  await waitFor(
    async ({ id, figureIndex, figureId }) =>
      !(await (await import('/src/app/composition.ts')).slidesStore.open(id)).current.slides[figureIndex].elements.some(
        (e) => e.id === figureId,
      ),
    { id, figureIndex, figureId },
  );
  assert.equal((await read()).current.slides[figureIndex].layoutId, 'text-only');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await waitFor(
    async ({ id, figureIndex, figureId }) =>
      (await (await import('/src/app/composition.ts')).slidesStore.open(id)).current.slides[figureIndex].elements.some(
        (e) => e.id === figureId,
      ),
    { id, figureIndex, figureId },
  );
  const download = page.waitForEvent('download', { timeout: 45000 });
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs(join(output, 'legacy-workspace.pptx'));
  const saved = (await read()).current;
  await page.reload();
  await title.waitFor();
  assert.deepEqual((await read()).current, saved);
  assert.equal(saved.speech, undefined, '旧稿不能伪造讲稿');
  for (let count = initial.slides.length; count > 0; count--) {
    await page.getByRole('button', { name: '删除本页', exact: true }).click();
    await waitFor(
      async ({ id, count }) =>
        (await (await import('/src/app/composition.ts')).slidesStore.open(id)).current.slides.length === count - 1,
      { id, count },
    );
  }
  assert.equal(await page.getByRole('button', { name: '导出 PPTX', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await title.waitFor();
  assert.equal((await read()).current.slides.length, 1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await title.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '新增页', exact: true }).click();
  await title.waitFor();
  assert.equal((await read()).current.slides.length, 1);
  await page.screenshot({ path: join(output, 'legacy-workspace.png') });
  console.log('PASS: 旧稿在正式工作台的输入法/焦点/选择/排序/元素/撤销/空稿/刷新/导出');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.routeWebSocket('**', (socket) => socket.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const output = join(tmpdir(), 'smartjc-checks');
    await mkdir(output, { recursive: true });
    await checkLegacyEditor(page, process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/', output);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
