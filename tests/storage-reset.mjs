import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const prefix = '/smart-journal-club/';
const directory = resolve('dist');
let holdResources = false;
let resumeResources;
let resourcesWaiting = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === `${prefix}probe.html`) {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<title>Uncoordinated old tab</title>');
    return;
  }
  if (!path.startsWith(prefix) || path.includes('..')) {
    response.writeHead(404);
    response.end();
    return;
  }
  const file = path.slice(prefix.length) || 'index.html';
  if (holdResources && file === 'index.html') {
    resourcesWaiting = true;
    await new Promise((resolve) => {
      resumeResources = resolve;
    });
  }
  try {
    const body = await readFile(resolve(directory, file));
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.wasm': 'application/wasm',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active && navigator.serviceWorker.controller;
  });
  const openReset = async () => {
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
    await page.getByRole('button', { name: '清除本应用所有数据', exact: true }).click();
    await page.getByRole('heading', { name: '清除本应用所有本地数据', exact: true }).waitFor();
  };
  await openReset();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/storage-reset-confirm.png' });
  await page.getByRole('button', { name: '返回应用', exact: true }).click();
  await openReset();
  const counts = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('smartjc');
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const tx = db.transaction([...db.objectStoreNames], 'readonly');
        return await Promise.all(
          [...db.objectStoreNames].map(
            (name) =>
              new Promise((resolve) => {
                const request = tx.objectStore(name).count();
                request.onsuccess = () => resolve(request.result);
              }),
          ),
        );
      } finally {
        db.close();
      }
    });
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('smartjc');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) tx.objectStore(name).put({ fixture: name }, 'reset-fixture');
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    db.close();
    const other = indexedDB.open('other-app', 1);
    other.onupgradeneeded = () => other.result.createObjectStore('data');
    await new Promise((resolve) => {
      other.onsuccess = () => {
        other.result.close();
        resolve();
      };
    });
    localStorage.setItem('smartjc-fixture', 'remove');
    sessionStorage.setItem('smartjc-speech-focus:fixture', 'remove');
    localStorage.setItem('other-app', 'keep');
    sessionStorage.setItem('other-app', 'keep');
    await (await caches.open('other-app')).put('/other-asset', new Response('keep'));
  });
  assert.deepEqual(await counts(), Array(7).fill(1));
  const erase = page.getByRole('button', { name: '永久清除所有数据', exact: true });
  assert.equal(await erase.isDisabled(), true);
  await page.getByLabel('输入“清除所有数据”以确认').fill('清除所有数据');
  holdResources = true;
  await page.evaluate(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      window.resourcesDone = true;
    };
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_RESOURCES' }, [channel.port2]);
  });
  const deadline = Date.now() + 10000;
  while (!resourcesWaiting && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resourcesWaiting, true);
  await erase.click();
  await page.getByText('离线资源正在准备，请等待完成后再清理。', { exact: true }).waitFor();
  assert.deepEqual(await counts(), Array(7).fill(1));
  holdResources = false;
  resumeResources();
  await page.waitForFunction(() => window.resourcesDone);
  const otherPage = await context.newPage();
  await otherPage.goto(`${base}?smartjc-reset-storage=1`);
  await otherPage.getByRole('heading', { name: '清除本应用所有本地数据' }).waitFor();
  await erase.click();
  await page.getByText('请先关闭其他 smartJC 标签页和应用窗口，再重试。', { exact: true }).waitFor();
  assert.deepEqual(await counts(), Array(7).fill(1));
  await otherPage.close();
  const oldPage = await context.newPage();
  await oldPage.goto(`${base}probe.html`);
  await erase.click();
  await page.getByText('请先关闭其他 smartJC 标签页和应用窗口，再重试。', { exact: true }).waitFor();
  assert.deepEqual(await counts(), Array(7).fill(1));
  await oldPage.close();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function () {
      if (this.name === 'papers') throw new Error('fixed failure');
      return original.call(this);
    };
    window.restoreClear = () => {
      IDBObjectStore.prototype.clear = original;
    };
  });
  await erase.click();
  await page.waitForFunction(() => !document.querySelector('input').disabled);
  await page.getByText('清理未全部完成，可能已删除部分数据。请保留此页并重试。', { exact: true }).waitFor();
  assert.deepEqual(await counts(), Array(7).fill(1));
  await page.evaluate(() => {
    window.restoreClear();
    const original = CacheStorage.prototype.delete;
    CacheStorage.prototype.delete = function (name) {
      if (name.startsWith('smartjc-static:')) return Promise.reject(new Error('fixed failure'));
      return original.call(this, name);
    };
    window.restoreCache = () => {
      CacheStorage.prototype.delete = original;
    };
  });
  await erase.click();
  await page.waitForFunction(() => !document.querySelector('input').disabled);
  await page.getByText('清理未全部完成，可能已删除部分数据。请保留此页并重试。', { exact: true }).waitFor();
  assert.deepEqual(await counts(), Array(7).fill(0));
  await page.evaluate(() => {
    window.restoreCache();
    const original = CacheStorage.prototype.delete;
    const gate = new Promise((resolve) => {
      window.finishReset = resolve;
    });
    CacheStorage.prototype.delete = async function (name) {
      if (name.startsWith('smartjc-static:')) {
        window.resetWaiting = true;
        await gate;
      }
      return original.call(this, name);
    };
  });
  await erase.click();
  await page.waitForFunction(() => window.resetWaiting);
  const freshPage = await context.newPage();
  await freshPage.goto(`${base}?smartjc-reset-storage=1`);
  await page.waitForFunction(async () =>
    (await navigator.locks.query()).pending.some((lock) => lock.name === 'smartjc-storage-session'),
  );
  assert.equal(await freshPage.getByRole('heading').count(), 0);
  await context.setOffline(true);
  await page.evaluate(() => window.finishReset());
  await freshPage.getByRole('heading', { name: '清除本应用所有本地数据', exact: true }).waitFor();
  await freshPage.close();
  await page.getByRole('heading', { name: '本应用数据已清除', exact: true }).waitFor();
  const result = await page.evaluate(async () => ({
    caches: await caches.keys(),
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    appLocal: localStorage.getItem('smartjc-fixture'),
    appSession: sessionStorage.getItem('smartjc-speech-focus:fixture'),
    otherLocal: localStorage.getItem('other-app'),
    otherSession: sessionStorage.getItem('other-app'),
    databases: (await indexedDB.databases()).map((db) => db.name),
    otherCache: await (await (await caches.open('other-app')).match('/other-asset')).text(),
  }));
  assert.deepEqual(result.caches, ['other-app']);
  assert.equal(result.registrations, 0);
  assert.equal(result.appLocal, null);
  assert.equal(result.appSession, null);
  assert.equal(result.otherLocal, 'keep');
  assert.equal(result.otherSession, 'keep');
  assert.equal(result.otherCache, 'keep');
  assert.ok(result.databases.includes('other-app'));
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/storage-reset-success.png' });
  await context.setOffline(false);
  await page.getByRole('button', { name: '重新打开应用' }).click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  assert.deepEqual(await counts(), Array(7).fill(0));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: confirmation/cancel, coordinated and old tabs, atomic rollback, partial cache failure/retry, offline reset, all seven stores and scoped caches/settings, unrelated data preserved, empty restart',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
