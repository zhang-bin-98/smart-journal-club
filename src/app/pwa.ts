import { isAppIdle } from './activity';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
type PwaState = { ready: boolean; waiting: boolean; installable: boolean; updating: boolean; error: string };
let state: PwaState = { ready: false, waiting: false, installable: false, updating: false, error: '' };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPrompt | undefined;
let started = false;
let acceptedUpdate = false;
const change = (next: Partial<PwaState>) => { state = { ...state, ...next }; listeners.forEach((listener) => { listener(); }); };
export const getPwaState = () => state;
export const subscribePwa = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function message<T>(worker: ServiceWorker, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); reject(new Error('离线服务暂未响应，请稍后重试。')); }, 10000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data as T); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
async function status() {
  if (!registration) return;
  change({ waiting: !!registration.waiting });
  if (registration.active) {
    const result = await message<{ ready: boolean }>(registration.active, 'CACHE_STATUS');
    change({ ready: result.ready, ...(!result.ready ? { error: '离线资源不完整，请联网后重试准备。' } : {}) });
  }
}
async function registerWorker() {
  const root = new URL(import.meta.env.BASE_URL, document.baseURI);
  const value = await navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname, updateViaCache: 'none' });
  registration = value;
  const watch = () => {
    const worker = value.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'activated') void status().catch(() => {});
      if (worker.state === 'redundant') change({ error: '离线资源准备失败，联网后可重试。' });
    });
  };
  value.addEventListener('updatefound', watch); watch();
  await status();
}
export function initializePwa() {
  if (started) return; started = true;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallPrompt; change({ installable: true }); });
  window.addEventListener('appinstalled', () => { installPrompt = undefined; change({ installable: false }); });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (acceptedUpdate && isAppIdle()) location.reload();
    else { acceptedUpdate = false; change({ updating: false }); void status().catch(() => {}); }
  });
  void registerWorker().catch(() => change({ error: '离线资源尚未准备完成，请联网后重试。' }));
  void navigator.storage?.persist?.().catch(() => false);
}
export async function retryPwa() {
  change({ error: '' });
  try {
    if (!registration || (!registration.active && !registration.waiting && !registration.installing)) await registerWorker();
    else {
      await registration.update();
      if (registration.active && !registration.waiting && !registration.installing && !state.ready) await message(registration.active, 'CACHE_RESOURCES');
      await status();
    }
  } catch { change({ error: '暂时无法检查应用资源，请联网后重试。' }); }
}
export async function installApp() {
  if (!installPrompt || !isAppIdle()) return;
  const prompt = installPrompt; installPrompt = undefined; change({ installable: false });
  try { await prompt.prompt(); await prompt.userChoice; } catch { change({ error: '安装未完成，可以通过浏览器菜单安装应用。' }); }
}
export async function applyAppUpdate() {
  if (!isAppIdle() || !registration?.waiting || state.updating) return;
  change({ updating: true, error: '' });
  try {
    // 更新准备期间UI阻止新操作；用户仍须主动点击本入口。
    acceptedUpdate = true;
    const result = await message<{ accepted: boolean }>(registration.waiting, 'ACTIVATE_UPDATE');
    if (!result.accepted) { acceptedUpdate = false; change({ updating: false, error: '请先关闭其他 smartJC 标签页，再更新此页面。' }); }
  } catch (cause) { acceptedUpdate = false; change({ updating: false, error: cause instanceof Error ? cause.message : '更新失败，请重试。' }); }
}
