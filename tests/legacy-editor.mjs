import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Same existing-deck editing chain used by the historical browser suite and M15 compatibility gate. */
export async function checkLegacyEditor(page, base, output) {
  await page.goto(`${base}#/fixture`);
  const title = page.getByRole('textbox', { name: '幻灯片标题', exact: true });
  await title.fill('中文草稿');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionstart', { data: '' });
  await title.fill('中文组合输入');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionend', { data: '输入' });
  await page.locator('[data-slide-id="slide-2"]').click();
  await page.locator('[data-slide-id="slide-1"]').click();
  assert.equal(await title.innerText(), '中文组合输入');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await title.innerText(), '一个可追溯的研究结论');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await title.innerText(), '中文组合输入');
  await page.getByRole('button', { name: '下移本页', exact: true }).click();
  assert.equal(await page.locator('[data-slide-id][aria-current="page"]').getAttribute('data-slide-id'), 'slide-1');
  assert.deepEqual(await page.locator('[data-slide-id]').evaluateAll((els) => els.map((el) => el.dataset.slideId)), [
    'slide-2',
    'slide-1',
    'slide-3',
  ]);
  await page.locator('[data-slide-id="slide-2"]').click();
  await page.locator('[data-slide-preview="current"] [data-element-id="f1"]').click();
  await page.getByRole('button', { name: '删除选中元素', exact: true }).click();
  await page.getByRole('tab', { name: '版式', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '选择布局' }).inputValue(), 'text-only');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const fixtureDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await fixtureDownload).saveAs(join(output, 'fixture.pptx'));
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '删除本页', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '导出 PPTX', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('[data-slide-id]').count(), 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.locator('[data-slide-id]').count(), 1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '新增页', exact: true }).first().click();
  assert.equal(await page.locator('[data-slide-id]').count(), 1);
  console.log('PASS: React draft/focus/composition/selection/reorder/undo/redo/empty/export');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: process.env.SMARTJC_BROWSER || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await page.routeWebSocket('**', (socket) => socket.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const output = join(tmpdir(), 'smartjc-checks');
    await mkdir(output, { recursive: true });
    await checkLegacyEditor(page, process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5174/', output);
    assert.deepEqual(errors, []);
    console.log('Artifacts:', output);
  } finally {
    await browser.close();
  }
}
