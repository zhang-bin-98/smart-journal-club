import { useEffect, useSyncExternalStore } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { isAppIdle, subscribeActivity } from '../activity';
import { applyAppUpdate, getPwaState, initializePwa, installApp, retryPwa, subscribePwa } from '../pwa';
import { Button } from './controls';

export function PwaNotice() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const idle = useSyncExternalStore(subscribeActivity, isAppIdle);
  useEffect(initializePwa, []);
  if (!import.meta.env.PROD && !state.installable) return null;
  return <>
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-end gap-3 px-5 pt-3 text-xs text-muted" aria-label="应用状态">
      <span role="status">{state.ready ? '本地离线功能已就绪' : '正在准备离线资源…'}</span>
      {state.installable && <Button disabled={!idle} onClick={() => void installApp()}><Download size={14} />安装应用</Button>}
      {state.waiting && <><span>{idle ? '有新版本可用' : '有新版本，完成保存并结束当前操作后可更新'}</span><Button disabled={!idle || state.updating} onClick={() => void applyAppUpdate()}><RefreshCw size={14} />更新并刷新</Button></>}
      {state.error && <><span role="alert">{state.error}</span><Button disabled={state.updating} onClick={() => void retryPwa()}>重试检查</Button></>}
    </div>
    {state.updating && <div role="status" className="fixed inset-0 z-[100] grid place-items-center bg-white/90 text-sm text-ink">正在更新应用…</div>}
  </>;
}
