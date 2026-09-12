import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = 'https://zhang-bin-98.github.io/smart-journal-club/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [],
    failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
  });
  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('main', { name: '模型配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
    {},
    { timeout: 180000 },
  );
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const swResponse = await page.request.get(base + 'sw.js', { headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(swResponse.status(), 200);
  const sw = await swResponse.text(),
    version = sw.match(/^const VERSION = "([a-f0-9]+)";/)[1];
  if (process.env.SMARTJC_VERIFY_LOCAL_BUILD === '1') {
    const local = await readFile('dist/sw.js', 'utf8');
    assert.equal(
      version,
      local.match(/^const VERSION = "([a-f0-9]+)";/)[1],
      'Deployed version differs from validated build',
    );
  }
  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('main', { name: '模型配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  const prefix =
    process.env.SMARTJC_VERIFY_LOCAL_BUILD === '1'
      ? 'output/playwright/m19-pages-final'
      : 'output/playwright/m19-pages-baseline';
  await page.screenshot({ path: prefix + '.jpg', type: 'jpeg' });
  await writeFile(
    prefix + '.json',
    JSON.stringify(
      {
        base,
        version,
        onlineSettingsReturn: true,
        offlineReload: true,
        pageErrors: errors,
        failed,
        verifiedLocalBuild: process.env.SMARTJC_VERIFY_LOCAL_BUILD === '1',
      },
      null,
      2,
    ),
  );
  console.log('PASS actual Pages online/settings return/service worker/offline reload: ' + version);
} finally {
  await browser.close();
}
