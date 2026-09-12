import { useEffect, useSyncExternalStore } from 'react';
import { Download, GitFork, RefreshCw } from 'lucide-react';
import { isAppIdle, subscribeActivity } from '../app/activity';
import { applyAppUpdate, getPwaState, initializePwa, installApp, retryPwa, subscribePwa } from '../app/pwa';
import { IconButton } from './controls';

const repositoryUrl = 'https://github.com/zhang-bin-98/smart-journal-club';

export function AppHeaderActions() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const idle = useSyncExternalStore(subscribeActivity, isAppIdle);
  const showPwaState = import.meta.env.PROD || state.installable || state.waiting || !!state.error;
  const message = state.error
    ? state.error
    : state.waiting
      ? idle
        ? '有新版本可用'
        : '保存并结束当前操作后可更新'
      : state.ready
        ? '离线就绪'
        : '正在准备离线资源…';
  return (
    <div className="flex shrink-0 items-center gap-2" aria-label="应用与项目链接">
      {showPwaState && (
        <span
          role={state.error ? 'alert' : 'status'}
          title={message}
          className={state.error ? 'max-w-44 truncate text-xs text-red-700' : 'max-w-44 truncate text-xs text-muted'}
        >
          {message}
        </span>
      )}
      {state.installable && (
        <IconButton label="安装应用" disabled={!idle} onClick={() => void installApp()}>
          <Download size={14} />
        </IconButton>
      )}
      {state.waiting && (
        <IconButton label="更新并刷新" disabled={!idle || state.updating} onClick={() => void applyAppUpdate()}>
          <RefreshCw size={14} />
        </IconButton>
      )}
      {state.error && (
        <IconButton label="重试检查" disabled={state.updating} onClick={() => void retryPwa()}>
          <RefreshCw size={14} />
        </IconButton>
      )}
      <a
        href={repositoryUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded border border-control bg-white px-3 py-2 text-xs leading-normal text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label="在新标签页打开 GitHub 项目"
        title="GitHub 项目"
      >
        <GitFork size={15} />
        GitHub
      </a>
    </div>
  );
}

export function PwaUpdateOverlay() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  useEffect(initializePwa, []);
  return (
    <>
      {state.updating && (
        <div role="status" className="fixed inset-0 z-[100] grid place-items-center bg-white/90 text-sm text-ink">
          正在更新应用…
        </div>
      )}
    </>
  );
}
