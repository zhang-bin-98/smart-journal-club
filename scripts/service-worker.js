const VERSION = __SMARTJC_VERSION__;
const FILES = __SMARTJC_FILES__;
const INTEGRITY = __SMARTJC_INTEGRITY__;
const ROOT = new URL('./', self.location.href);
const PREFIX = 'smartjc-static:' + ROOT.pathname + ':';
const CACHE = PREFIX + VERSION;
const URLS = FILES.map(file => new URL(file, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(FILES.map(file => new Request(new URL(file, ROOT), { cache: 'reload', integrity: INTEGRITY[file] }))); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
    // 保留最近旧构建的静态资源，防止另一标签页刚加载的旧模块失效。
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname) || request.headers.has('authorization')) return;
  const navigation = request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === ROOT.pathname + 'index.html');
  const key = navigation ? new URL('index.html', ROOT).href : url.origin + url.pathname;
  if (!navigation && !URLS.includes(key) && !url.pathname.startsWith(ROOT.pathname + 'assets/')) return;
  event.respondWith((async () => {
    const current = await caches.open(CACHE);
    const cached = await current.match(key);
    if (cached) return cached;
    if (!navigation) {
      const previous = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE).reverse();
      for (const name of previous) { const response = await (await caches.open(name)).match(key); if (response) return response; }
    }
    return fetch(request);
  })());
});
self.addEventListener('message', event => {
  const reply = value => event.ports[0]?.postMessage(value);
  if (event.data?.type === 'CACHE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const ready = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
      reply({ ready, version: VERSION });
    })());
  }
  if (event.data?.type === 'CACHE_RESOURCES') {
    event.waitUntil((async () => {
      try {
        const response = await fetch(new Request(self.location.href, { cache: 'no-store' }));
        if (!response.ok || !(await response.text()).startsWith('const VERSION = ' + JSON.stringify(VERSION) + ';')) { reply({ ready: false, updateRequired: true }); return; }
        await (await caches.open(CACHE)).addAll(FILES.map(file => new Request(new URL(file, ROOT), { cache: 'reload', integrity: INTEGRITY[file] }))); reply({ ready: true }); }
      catch { reply({ ready: false }); }
    })());
  }
  if (event.data?.type === 'ACTIVATE_UPDATE') {
    event.waitUntil((async () => {
      const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(ROOT.href));
      if (clients.some(client => client.id !== event.source?.id)) { reply({ accepted: false }); return; }
      reply({ accepted: true }); await self.skipWaiting();
    })());
  }
});
