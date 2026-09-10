import assert from 'node:assert/strict';
import { responsesEvent } from './responses-fixture.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.SMARTJC_BROWSER || 'msedge', headless: true });
await mkdir('output/playwright', { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/');
  const pdf = (await readFile('test-fixtures/papers/clinical-vrc07-phase1-trial.pdf')).toString('base64');
  const id = await page.evaluate(async (pdf) => {
    const bytes = Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0));
    const { createM16Fixture } = await import('/tests/m16-fixture.ts');
    return createM16Fixture(new Blob([bytes], { type: 'application/pdf' }));
  }, pdf);
  await page.goto(`${process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/'}#/project/${id}`);
  await page.getByRole('button', { name: '确认切分', exact: true }).waitFor();
  await page.getByRole('button', { name: 'A', exact: true }).first().click();
  await page.getByLabel('Panel 标签', { exact: true }).fill('B');
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await page.getByRole('button', { name: 'B', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: 'A', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: 'B', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  await page.getByRole('button', { name: '切分已确认', exact: true }).waitFor();

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('canvas[aria-label="当前选区严格裁切预览"]')].some(
        (canvas) => canvas.width > 50 && !canvas.classList.contains('hidden'),
      ),
    { timeout: 60000 },
  );
  const canvas = page.getByRole('application', { name: '图源框选画布' }).first();
  await canvas.focus();
  await canvas.press('ArrowRight');
  await page.getByRole('button', { name: '确认切分', exact: true }).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  await page.getByRole('button', { name: '切分已确认', exact: true }).waitFor();

  await page.getByRole('button', { name: '＋ 添加 Panel', exact: true }).click();
  const addView = await canvas.boundingBox();
  assert.ok(addView);
  await page.mouse.move(addView.x + addView.width * 0.25, addView.y + addView.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(addView.x + addView.width * 0.45, addView.y + addView.height * 0.4, { steps: 5 });
  await page.mouse.up();
  const newLabel = page.getByLabel('新 Panel 标签', { exact: true });
  await newLabel.fill('Q');
  await newLabel.evaluate((input) =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })),
  );
  assert.equal(await newLabel.isVisible(), true, '输入法组合期间 Enter 不提交');
  await newLabel.press('Enter');
  await page.locator('article[data-region]').first().getByRole('button', { name: 'Q', exact: true }).click();
  assert.equal(await canvas.getByRole('button').count(), 8);
  await canvas.press('Delete');
  await page.getByRole('button', { name: 'Q', exact: true }).first().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: 'Q', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: 'Q', exact: true }).first().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '＋ 添加 Figure', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加 Figure', exact: true });
  await dialog.getByRole('combobox', { name: '原图号' }).fill('Figure 99');
  await dialog.getByRole('combobox', { name: '原图号' }).press('Escape');
  await dialog.getByLabel('添加 Figure 来源文件').selectOption({ label: '补充材料 · supplement.pdf' });
  await dialog.getByText('正在读取原图…', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
  await page.waitForFunction(() => {
    const svg = document.querySelector('[aria-label="添加 Figure"] svg[role="application"]');
    return svg?.getAttribute('aria-busy') === 'false';
  });
  const draw = await dialog.getByRole('application', { name: '图源框选画布' }).boundingBox();
  assert.ok(draw);
  await page.mouse.move(draw.x + draw.width * 0.15, draw.y + draw.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(draw.x + draw.width * 0.55, draw.y + draw.height * 0.35, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: 'output/playwright/m16-add-draft.png' });
  await dialog.getByRole('button', { name: '保存图块', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const newCard = page.locator('article[data-region]').last();
  await newCard.getByRole('button', { name: 'Figure 99', exact: true }).click();
  await newCard.getByRole('combobox', { name: '原图号' }).fill('Figure 3');
  await newCard.getByRole('combobox', { name: '原图号' }).press('Escape');
  await newCard.getByRole('button', { name: '保存图块', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认图块归入已有 Figure', exact: true });
  await confirm.getByRole('button', { name: '返回编辑', exact: true }).click();
  assert.equal(await newCard.getByRole('combobox', { name: '原图号' }).inputValue(), 'Figure 3');
  await newCard.getByRole('button', { name: '保存图块', exact: true }).click();
  await confirm.getByRole('button', { name: '确认归入', exact: true }).click();
  await confirm.waitFor({ state: 'hidden' });
  const saved = await page.evaluate(
    async (id) => (await (await import('/src/infrastructure/persistence/projectStore.ts')).openProject(id)).paper,
    id,
  );
  assert.equal(saved.figures.length, 1);
  assert.equal(saved.figures[0].regions.length, 2);
  assert.equal(
    saved.sources.find((source) => source.id === saved.figures[0].regions[1].sourceId).documentId,
    saved.documents[1].id,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  await page.getByRole('button', { name: '切分已确认', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/m16-review.png' });
  // A real IndexedDB failure must leave the editable draft and Undo cursor intact.
  await page.getByRole('button', { name: 'B', exact: true }).first().click();
  await page.getByLabel('Panel 标签', { exact: true }).fill('C');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('fixed storage failure', 'QuotaExceededError');
      }
      return original.call(this, stores, mode, options);
    };
  });
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Panel 标签', { exact: true }).inputValue(), 'C');
  await page.getByLabel('Panel 标签', { exact: true }).fill('D');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByRole('button', { name: 'D', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: 'B', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '切分已确认', exact: true }).waitFor();
  await page.getByRole('button', { name: 'B', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '模型配置', exact: true }).click();
  const settings = page.getByRole('main', { name: '模型配置', exact: true });
  await settings.getByLabel('Base URL', { exact: true }).fill('https://m16-fixed.example');
  await settings.getByLabel('模型 ID', { exact: true }).fill('fixed-responses');
  await settings.getByLabel('API Key', { exact: true }).fill('fixed-key-not-secret');
  await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
  await page.route('https://m16-fixed.example/responses', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: responsesEvent({
        tool_calls: [
          {
            function: {
              name: 'submit_result',
              arguments: JSON.stringify({
                result: {
                  panels: [
                    { label: 'Z', description: '固定行为回归候选', bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } },
                  ],
                  concerns: [],
                },
              }),
            },
          },
        ],
      }),
    }),
  );
  await page.getByText('更多', { exact: true }).click();
  await page.getByRole('button', { name: '重新识别当前图', exact: true }).click();
  await page.getByRole('button', { name: '应用候选', exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'B', exact: true }).count());
  await page.getByRole('button', { name: '放弃候选', exact: true }).click();
  await page.getByRole('button', { name: '重新识别当前图', exact: true }).click();
  await page.getByRole('button', { name: '应用候选', exact: true }).click();
  await page.getByRole('button', { name: 'Z', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '确认切分', exact: true }).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: 'B', exact: true }).first().waitFor();
  await page.getByRole('separator', { name: '调整图源目录宽度' }).press('ArrowRight');
  await page.getByLabel('图源缩放', { exact: true }).selectOption('1.5');
  await page.getByLabel('图源缩放', { exact: true }).selectOption('1');

  const rotation = await page.evaluate(async (pdf) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({ data: Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0)) });
    const doc = await task.promise;
    try {
      const pdfPage = await doc.getPage(9);
      const normal = pdfPage.getViewport({ scale: 1 });
      const rotated = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + 90) % 360 });
      const originalPoint = normal.convertToPdfPoint(normal.width * 0.3, normal.height * 0.4);
      const point = rotated.convertToViewportPoint(...originalPoint);
      const roundTrip = rotated.convertToPdfPoint(...point);
      return {
        swapped: Math.abs(normal.width - rotated.height) < 0.01 && Math.abs(normal.height - rotated.width) < 0.01,
        roundTrip: originalPoint.every((value, index) => Math.abs(value - roundTrip[index]) < 0.001),
      };
    } finally {
      await task.destroy();
    }
  }, pdf);
  assert.deepEqual(rotation, { swapped: true, roundTrip: true });
  const protection = await page.evaluate(async (id) => {
    const { openProject } = await import('/src/infrastructure/persistence/projectStore.ts');
    const { saveFigure } = await import('/src/infrastructure/persistence/paperStore.ts');
    const { transaction, get } = await import('/src/shared/persistence/indexedDb.ts');
    const { fixtureDeck } = await import('/tests/fixtures.ts');
    const data = await openProject(id);
    const current = structuredClone(fixtureDeck);
    current.id = 'm16-current';
    current.paperId = data.paper.id;
    current.slides[1].elements[0].cropOverride = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
    const previous = { ...structuredClone(current), id: 'm16-previous' };
    await transaction(['projects', 'decks'], 'readwrite', async (tx) => {
      tx.objectStore('decks').put(current, current.id);
      tx.objectStore('decks').put(previous, previous.id);
      tx.objectStore('projects').put({ ...data.project, currentDeckId: current.id, previousDeckId: previous.id }, id);
    });
    const region = data.paper.figures[0].regions[0];
    const saved = await saveFigure({
      projectId: id,
      paperId: data.paper.id,
      revision: data.paper.revision,
      reviewRevision: data.paper.figureReview.revision,
      command: { kind: 'label', regionId: region.id, panelId: region.panels[0].id, label: 'protected' },
      assertCurrent() {},
    });
    return transaction(['papers', 'decks'], 'readonly', async (tx) => ({
      copied: saved.paper.id !== data.paper.id,
      frozen: JSON.stringify(await get(tx, 'papers', data.paper.id)) === JSON.stringify(data.paper),
      current: JSON.stringify(await get(tx, 'decks', current.id)) === JSON.stringify(current),
      previous: JSON.stringify(await get(tx, 'decks', previous.id)) === JSON.stringify(previous),
    }));
  }, id);
  assert.deepEqual(protection, { copied: true, frozen: true, current: true, previous: true });
  await page.reload();
  await page.getByText(/受影响的已有讲稿/).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(
    'output/playwright/m16-fixed-browser.json',
    JSON.stringify(
      {
        id,
        errors,
        checks: [
          'label',
          'undo',
          'redo',
          'confirmation',
          'reload',
          'panel-add-delete',
          'IME-enter',
          'eight-handles',
          'supplement-figure',
          'move-confirm-cancel',
          'storage-failure-retry',
          'recognition-candidate',
          'divider-zoom',
          'rotated-viewport-roundtrip',
          'frozen-current-previous-crop',
        ],
      },
      null,
      2,
    ),
  );
  console.log('M16 fixed browser checks passed');
} finally {
  await browser.close();
}
