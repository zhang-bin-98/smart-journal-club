import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fixtureDeck, fixturePaper } from '../src/fixtures.ts';
const MODEL_ID = (await readFile(resolve('src/shared/llm/model.ts'), 'utf8')).match(/export const MODEL_ID = '([^']+)'/)[1];

const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const directory = resolve('dist'); const prefix = '/smart-journal-club/';
const output = join(tmpdir(), 'smartjc-checks'); await mkdir(output, { recursive: true });
const workerSource = await readFile(join(directory, 'sw.js'), 'utf8');
assert.match(workerSource, /^const VERSION = "[a-f0-9]+";/);
const files = JSON.parse(workerSource.match(/^const FILES = (.+);$/m)[1]);
const blockedAsset = files.find(file => /^assets\/export-/.test(file));
assert.ok(blockedAsset);
const indexSource = await readFile(join(directory, 'index.html'), 'utf8');
const secondIndex = indexSource + '\n<!-- fixed second production build -->';
const integrity = JSON.parse(workerSource.match(/^const INTEGRITY = (.+);$/m)[1]);
const secondIntegrity = { ...integrity, 'index.html': 'sha256-' + createHash('sha256').update(secondIndex).digest('base64') };
const secondWorker = workerSource.replace(/^(const VERSION = ")([^"]+)(";)/, '$1$2-test-update$3').replace(/^const INTEGRITY = .+;$/m, 'const INTEGRITY = ' + JSON.stringify(secondIntegrity) + ';');
let updateVersion = false; let failInitialInstall = true;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  const file = resolve(directory, pathname.slice(prefix.length) || 'index.html');
  if (!file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try {
    if (failInitialInstall && file === resolve(directory, blockedAsset)) { response.writeHead(404).end(); return; }
    const content = file === join(directory, 'sw.js') ? (updateVersion ? secondWorker : workerSource) : file === join(directory, 'index.html') && updateVersion ? secondIndex : await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({ channel: process.env.SMARTJC_BROWSER || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const projectId = 'pwa-fixed-project';
const readState = page => page.evaluate(async id => {
  const open = indexedDB.open('smartjc', 1);
  const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
  const tx = db.transaction(['projects', 'decks', 'papers', 'assets', 'settings']);
  const get = (store, key) => new Promise(resolve => { const read = tx.objectStore(store).get(key); read.onsuccess = () => resolve(read.result); });
  const project = await get('projects', id); const deck = await get('decks', project.currentDeckId); const paper = await get('papers', project.paperId);
  const asset = await get('assets', project.pdfAssetId); const settings = await get('settings', 'model');
  const result = { project, deck, paper, assetSize: asset.blob.size, settings };
  tx.oncomplete = () => db.close(); return result;
}, projectId);
const workerStatus = page => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; registration.active.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]); });
});
try {
  let page = await context.newPage(); await page.goto(base);
  await page.getByRole('button', { name: '重试检查', exact: true }).waitFor({ timeout: 120000 });
  await page.evaluate(() => { window.__firstInstallNoReload = true; });
  failInitialInstall = false;
  await page.getByRole('button', { name: '重试检查', exact: true }).click();
  await page.getByText('本地离线功能已就绪', { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__firstInstallNoReload), true);
  console.log('PASS: failed first install/retry without reload');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const initialWorker = await workerStatus(page);
  assert.equal(initialWorker.ready, true);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), base);
  const manifest = await page.locator('link[rel=manifest]').getAttribute('href');
  assert.equal(new URL(manifest, base).pathname, prefix + 'manifest.webmanifest');
  const pdf = (await readFile(resolve('test-fixtures/papers/mechanism-modt-cdifficile.pdf'))).toString('base64');
  await page.evaluate(async ({ projectId, deck, paper, pdf, modelId }) => {
    const open = indexedDB.open('smartjc', 1);
    const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const tx = db.transaction(['projects', 'decks', 'papers', 'assets', 'settings'], 'readwrite');
    const now = Date.now(); const pdfAssetId = 'pwa-fixed-pdf';
    tx.objectStore('projects').put({ schemaVersion: 1, id: projectId, name: 'PWA 固定项目', paperId: paper.id, pdfAssetId, checkpoint: 'deck-ready', currentDeckId: deck.id, lastOpenedSlideId: deck.slides[1].id, preferences: { instruction: '', strategyId: 'general' }, createdAt: now, updatedAt: now }, projectId);
    tx.objectStore('decks').put(deck, deck.id); tx.objectStore('papers').put(paper, paper.id);
    tx.objectStore('assets').put({ name: 'mechanism-modt-cdifficile.pdf', blob: new Blob([Uint8Array.from(atob(pdf), char => char.charCodeAt(0))], { type: 'application/pdf' }) }, pdfAssetId);
    tx.objectStore('settings').put({ modelId, apiKey: 'fixed-test-key' }, 'model');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    await (await caches.open('other-app-fixed-cache')).put('/other-app-marker', new Response('keep me'));
  }, { projectId, deck: fixtureDeck, paper: fixturePaper, pdf, modelId: MODEL_ID });

  // 首次只打开首页；PDF 和导出模块必须来自构建缓存，而非之前的在线操作。
  await context.setOffline(true); await page.close(); page = await context.newPage();
  await page.goto(base + '#/project/' + projectId);
  await page.locator('[data-slide-preview=current] img').waitFor().catch(async cause => { console.error({ body: await page.locator('body').innerText(), errors }); throw cause; });
  await page.locator('[data-slide-preview=current] [data-element-id=f1]').click();
  await page.getByRole('button', { name: '裁图', exact: true }).click();
  await page.getByText('正在加载原页…').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0), true);
  const bounds = await page.locator('[data-pdf-page]').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .15, bounds.y + bounds.height * .15);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .5, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: '应用到本页', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const title = page.getByRole('textbox', { name: '幻灯片标题', exact: true });
  await title.fill('离线修改仍可保存'); await page.getByRole('textbox', { name: 'AI 输入', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  const artifact = join(output, 'pwa-offline.pptx'); await (await download).saveAs(artifact);
  assert.equal((await readFile(artifact)).subarray(0, 2).toString(), 'PK');
  const offlineState = await readState(page);
  assert.ok(offlineState.deck.slides[1].elements.find(element => element.id === 'f1').cropOverride);
  assert.equal(offlineState.deck.slides[2].elements.some(element => element.cropOverride), false);
  await page.close(); page = await context.newPage(); await page.goto(base + '#/project/' + projectId);
  await page.locator('[data-slide-preview=current] img').waitFor().catch(async cause => { console.error({ body: await page.locator('body').innerText(), errors }); throw cause; });
  assert.equal(await page.getByRole('textbox', { name: '幻灯片标题', exact: true }).innerText(), '离线修改仍可保存');
  assert.deepEqual((await readState(page)).deck, offlineState.deck);
  await page.screenshot({ path: join(output, 'pwa-offline.png'), fullPage: true });
  console.log('PASS: production Pages subpath/cold offline reopen/PDF/crop/save/lazy export/IDB reopen');

  await context.setOffline(false); updateVersion = true;
  await page.evaluate(async ({ version, asset }) => {
    const name = (await caches.keys()).find(key => key.startsWith('smartjc-static:') && key.endsWith(':' + version));
    await (await caches.open(name)).delete(new URL(asset, location.href));
  }, { version: initialWorker.version, asset: blockedAsset });
  await page.evaluate(() => { window.__pwaNoReload = 'preserved'; });
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  const update = page.getByRole('button', { name: '更新并刷新', exact: true });
  await update.waitFor({ timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__pwaNoReload), 'preserved');
  assert.equal((await workerStatus(page)).version, initialWorker.version);
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), true);
  await page.getByRole('button', { name: '重试检查', exact: true }).click();
  const repair = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; registration.active.postMessage({ type: 'CACHE_RESOURCES' }, [channel.port2]); });
  });
  assert.equal(repair.updateRequired, true);
  const previousCache = await page.evaluate(async ({ version, asset }) => {
    const name = (await caches.keys()).find(key => key.startsWith('smartjc-static:') && key.endsWith(':' + version));
    const cache = await caches.open(name);
    return { missing: !(await cache.match(new URL(asset, location.href))), index: await (await cache.match(new URL('index.html', location.href))).text() };
  }, { version: initialWorker.version, asset: blockedAsset });
  assert.equal(previousCache.missing, true);
  assert.equal(previousCache.index, indexSource);
  console.log('PASS: incomplete old cache does not mix new index while update waits');
  await page.getByRole('textbox', { name: '幻灯片标题', exact: true }).fill('更新前保存的文字');
  assert.equal(await update.isDisabled(), true);
  await page.getByRole('textbox', { name: 'AI 输入', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await update.isDisabled(), false);
  let heldRequest; let markHeld; const modelHeld = new Promise(resolve => { markHeld = resolve; });
  await page.route('https://api.deepseek.com/chat/completions', route => { heldRequest = route; markHeld(); });
  await page.getByRole('textbox', { name: 'AI 输入', exact: true }).fill('解释这页');
  await page.getByRole('button', { name: '发送', exact: true }).click(); await modelHeld;
  assert.equal(await update.isDisabled(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click(); await heldRequest.abort().catch(() => {});
  await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await update.isDisabled(), false);
  await page.unroute('https://api.deepseek.com/chat/completions');
  const second = await context.newPage(); await second.goto(base + '#/project/' + projectId);
  await second.getByRole('textbox', { name: '幻灯片标题', exact: true }).fill('另一标签页未保存草稿');
  await second.evaluate(() => { window.__pwaOtherNoReload = true; });
  await update.click();
  await page.getByText('请先关闭其他 smartJC 标签页，再更新此页面。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__pwaNoReload), 'preserved');
  assert.equal(await second.evaluate(() => window.__pwaOtherNoReload), true);
  assert.equal(await second.getByRole('textbox', { name: '幻灯片标题', exact: true }).innerText(), '另一标签页未保存草稿');
  await second.close();
  const beforeUpdate = await readState(page);
  await Promise.all([page.waitForEvent('load'), update.click()]);
  await page.getByText('本地离线功能已就绪', { exact: true }).waitFor();
  assert.equal((await workerStatus(page)).version, initialWorker.version + '-test-update');
  assert.deepEqual(await readState(page), beforeUpdate);
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('other-app-fixed-cache')), true);
  assert.equal(await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith('smartjc-static:'));
    const urls = (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat();
    return urls.some(url => url.includes('api.deepseek.com'));
  }), false);
  assert.deepEqual(errors, []);
  console.log('PASS: update waiting/no automatic reload/dirty and busy guard/other tab preserved/user accepted reload/IDB and unrelated cache preserved/API uncached');
  console.log('Artifacts:', output);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
