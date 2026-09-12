import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { HomePage } from '../ui/HomePage';
import { DEFAULT_SETTINGS, type ModelSettings } from './settings/modelSettings';
import { settingsService, analysisService } from './composition';
import { beginActivity, isAppIdle, setDirty, subscribeActivity, type LeaveGuard } from './activity';
import { errorMessage } from '../ui/controls';
import { PwaNotice } from '../ui/PwaNotice';
import { SettingsPage } from '../ui/settings/SettingsPage';
const ProjectWorkspace = lazy(() =>
  import('../ui/project/ProjectWorkspace').then((module) => ({ default: module.ProjectWorkspace })),
);
export function App() {
  const [hash, setHash] = useState(location.hash);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [legacySettings, setLegacySettings] = useState(false);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const settingsScroll = useRef({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [navigationError, setNavigationError] = useState('');
  const acceptedHash = useRef(hash);
  const leaveGuard = useRef<LeaveGuard | undefined>(undefined);
  const navigating = useRef(false);
  const pendingHash = useRef<string | undefined>(undefined);
  const settingsOpen = useRef(false);
  const registerLeaveGuard = useCallback((guard?: LeaveGuard) => {
    leaveGuard.current = guard;
  }, []);
  const navigate = useCallback(async (nextHash: string, changed = false) => {
    if (nextHash === acceptedHash.current) return;
    if (navigating.current) {
      if (nextHash !== pendingHash.current)
        history.replaceState(null, '', pendingHash.current || location.pathname + location.search);
      return;
    }
    navigating.current = true;
    pendingHash.current = nextHash;
    const done = beginActivity();
    try {
      if (settingsOpen.current) throw new Error('请先保存或返回模型配置');
      await leaveGuard.current?.();
      if (!changed) history.pushState(null, '', nextHash);
      else history.replaceState(null, '', nextHash || location.pathname + location.search);
      acceptedHash.current = nextHash;
      setHash(nextHash);
      setNavigationError('');
    } catch (cause) {
      history.replaceState(null, '', acceptedHash.current || location.pathname + location.search);
      setNavigationError(errorMessage(cause));
    } finally {
      navigating.current = false;
      pendingHash.current = undefined;
      done();
    }
  }, []);
  useEffect(
    () =>
      subscribeActivity(() => {
        if (isAppIdle()) setNavigationError('');
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    const done = beginActivity();
    settingsService
      .load()
      .then(
        (value) => {
          if (active) {
            setSettings(value.settings);
            setLegacySettings(value.legacy);
          }
        },
        (cause) => {
          if (active) setError(errorMessage(cause));
        },
      )
      .finally(done);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const update = () => {
      void navigate(location.hash, true);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isAppIdle()) event.preventDefault();
    };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('beforeunload', beforeUnload);
      setDirty('settings-dialog', false);
    };
  }, [navigate]);
  async function openSettings() {
    if (settingsOpen.current) return;
    settingsTrigger.current = document.activeElement as HTMLElement;
    settingsScroll.current = { x: window.scrollX, y: window.scrollY };
    settingsOpen.current = true;
    try {
      const record = await settingsService.load();
      setSettings((previous) =>
        (Object.keys(previous) as (keyof ModelSettings)[]).every((key) => previous[key] === record.settings[key])
          ? previous
          : record.settings,
      );
      setLegacySettings(record.legacy);
      setDirty('settings-dialog', true);
      setShowSettings(true);
    } catch (cause) {
      settingsOpen.current = false;
      setError(errorMessage(cause));
    }
  }
  function closeSettings() {
    settingsOpen.current = false;
    setDirty('settings-dialog', false);
    setShowSettings(false);
    requestAnimationFrame(() => {
      settingsTrigger.current?.focus({ preventScroll: true });
      window.scrollTo(settingsScroll.current.x, settingsScroll.current.y);
    });
  }
  const projectId = /^#\/project\/([^/]+)$/.exec(hash)?.[1];
  return (
    <>
      <PwaNotice />
      {(error || navigationError) && (
        <p role="alert" className="p-3 text-sm text-red-700">
          {error || navigationError}
        </p>
      )}
      <Suspense
        fallback={
          <p role="status" className="p-6 text-sm text-muted">
            正在打开…
          </p>
        }
      >
        <div hidden={showSettings} inert={showSettings}>
          {projectId ? (
            <ProjectWorkspace
              key={projectId}
              id={decodeURIComponent(projectId)}
              onOpenProject={(id) => {
                void navigate(`#/project/${encodeURIComponent(id)}`);
              }}
              settings={settings}
              onSettings={openSettings}
              onLeave={() => {
                void navigate('#/');
              }}
              registerLeaveGuard={registerLeaveGuard}
            />
          ) : (
            <HomePage
              modelReady={!!settings.apiKey.trim()}
              onStartAnalysis={(id) => {
                void analysisService
                  .session(id)
                  .start(settings)
                  .catch((cause) => setError(errorMessage(cause)));
                void navigate(`#/project/${encodeURIComponent(id)}`);
              }}
              onSettings={openSettings}
              openProject={(id) => {
                void navigate(`#/project/${encodeURIComponent(id)}`);
              }}
              registerLeaveGuard={registerLeaveGuard}
            />
          )}
        </div>
        {showSettings && (
          <SettingsPage
            settings={settings}
            legacy={legacySettings}
            returnLabel={projectId ? '返回项目' : '返回项目列表'}
            onSaved={(next) => {
              setSettings(next);
              setLegacySettings(false);
            }}
            onClose={closeSettings}
          />
        )}
      </Suspense>
    </>
  );
}
