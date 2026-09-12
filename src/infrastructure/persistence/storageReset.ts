import { stores, transaction } from './indexedDb';

const LOCK = 'smartjc-storage-session';
let releaseSession: (() => void) | undefined;
let sessionFinished: Promise<unknown> = Promise.resolve();

/** 页面持有共享锁；清理独占期间新页面等待，已有页面必须先关闭。 */
export async function holdStorageSession(): Promise<void> {
  if (!navigator.locks) return;
  await new Promise<void>((resolve, reject) => {
    sessionFinished = navigator.locks
      .request(LOCK, { mode: 'shared' }, async () => {
        await new Promise<void>((release) => {
          releaseSession = release;
          resolve();
        });
      })
      .catch(reject);
  });
}

function workerMessage(worker: ServiceWorker, type: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('离线服务未响应，请更新应用后重试。'));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.busy) reject(new Error('离线资源正在准备，请等待完成后再清理。'));
      else resolve(event.data?.accepted === true);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

function clearNamespacedStorage(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key?.startsWith('smartjc-') || key?.startsWith('smartjc:')) storage.removeItem(key);
  }
}

/** 只清理明确属于本应用的存储；七个数据仓库在单次事务内全部清空。 */
export async function clearAppStorage(): Promise<void> {
  if (!navigator.locks) throw new Error('当前浏览器无法检查其他标签页，请使用支持 Web Locks 的浏览器。');
  releaseSession?.();
  releaseSession = undefined;
  await sessionFinished;
  try {
    await navigator.locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('请先关闭其他 smartJC 标签页和应用窗口，再重试。');
      const root = new URL(import.meta.env.BASE_URL, document.baseURI);
      const registration =
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).find((value) => value.scope === root.href)
          : undefined;
      if (registration?.installing || registration?.waiting)
        throw new Error('应用更新尚未完成，请返回应用完成更新后再清理。');
      const controller = navigator.serviceWorker?.controller;
      const worker =
        registration?.active ?? (controller?.scriptURL === new URL('sw.js', root).href ? controller : undefined);
      if (worker && !(await workerMessage(worker, 'PREPARE_STORAGE_RESET')))
        throw new Error('请先关闭其他 smartJC 标签页和应用窗口，再重试。');
      try {
        await transaction([...stores], 'readwrite', async (tx) => {
          for (const store of stores) tx.objectStore(store).clear();
        });
        clearNamespacedStorage(localStorage);
        clearNamespacedStorage(sessionStorage);
        if (registration) await registration.unregister();
        if ('caches' in window) {
          const prefix = `smartjc-static:${root.pathname}:`;
          for (const name of await caches.keys()) {
            if (name.startsWith(prefix)) await caches.delete(name);
          }
        }
      } catch (cause) {
        if (worker) await workerMessage(worker, 'RESUME_AFTER_STORAGE_RESET').catch(() => false);
        throw cause;
      }
    });
  } finally {
    await holdStorageSession();
  }
}
