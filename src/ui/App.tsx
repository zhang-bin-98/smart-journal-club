import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { HomePage } from './HomePage';
import { DEFAULT_SETTINGS, type ModelSettings } from '../shared/llm/model';
import { loadSettings } from '../shared/llm/settingsRepository';
import { beginActivity, isAppIdle, setDirty, subscribeActivity, type LeaveGuard } from '../activity';
import { errorMessage } from './controls';
import { PwaNotice } from './PwaNotice';
const SettingsDialog = lazy(() => import('./SettingsDialog').then(module => ({ default: module.SettingsDialog })));
const ProjectPage = lazy(() => import('./ProjectPage').then(module => ({ default: module.ProjectPage })));
const FixturePage = import.meta.env.DEV ? lazy(() => import('./FixturePage')) : undefined;
export function App() {
  const [hash, setHash] = useState(location.hash);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [navigationError, setNavigationError] = useState('');
  const acceptedHash = useRef(hash);
  const leaveGuard = useRef<LeaveGuard | undefined>(undefined);
  const navigating = useRef(false);
  const pendingHash = useRef<string | undefined>(undefined);
  const settingsOpen = useRef(false);
  const registerLeaveGuard = useCallback((guard?: LeaveGuard) => { leaveGuard.current = guard; }, []);
  const navigate = useCallback(async (nextHash: string, changed = false) => {
    if (nextHash === acceptedHash.current) return;
    if (navigating.current) { if (nextHash !== pendingHash.current) history.replaceState(null, '', pendingHash.current || location.pathname + location.search); return; }
    navigating.current = true; pendingHash.current = nextHash; const done = beginActivity();
    try {
      if (settingsOpen.current) throw new Error('请先保存或关闭模型设置');
      await leaveGuard.current?.();
      if (!changed) history.pushState(null, '', nextHash); else history.replaceState(null, '', nextHash || location.pathname + location.search);
      acceptedHash.current = nextHash; setHash(nextHash); setNavigationError('');
    } catch (cause) {
      history.replaceState(null, '', acceptedHash.current || location.pathname + location.search);
      setNavigationError(errorMessage(cause));
    } finally { navigating.current = false; pendingHash.current = undefined; done(); }
  }, []);
  useEffect(() => subscribeActivity(() => { if (isAppIdle()) setNavigationError(''); }), []);
  useEffect(() => {
    let active = true; const done = beginActivity();
    loadSettings().then(value => { if (active) setSettings(value); }, cause => { if (active) setError(errorMessage(cause)); }).finally(done);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const update = () => { void navigate(location.hash, true); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!isAppIdle()) event.preventDefault(); };
    window.addEventListener('hashchange', update); window.addEventListener('popstate', update); window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); window.removeEventListener('beforeunload', beforeUnload); setDirty('settings-dialog', false); };
  }, [navigate]);
  function openSettings() { settingsOpen.current = true; setDirty('settings-dialog', true); setShowSettings(true); }
  function closeSettings() { settingsOpen.current = false; setDirty('settings-dialog', false); setShowSettings(false); }
  const projectId = /^#\/project\/([^/]+)$/.exec(hash)?.[1];
  return <>
    <PwaNotice />
    {(error || navigationError) && <p role="alert" className="p-3 text-sm text-red-700">{error || navigationError}</p>}
    <Suspense fallback={<p role="status" className="p-6 text-sm text-muted">正在打开…</p>}>
      {hash === '#/fixture' && FixturePage ? <FixturePage /> : projectId ? <ProjectPage key={projectId} id={decodeURIComponent(projectId)} settings={settings} onSettings={openSettings} onLeave={() => { void navigate('#/'); }} registerLeaveGuard={registerLeaveGuard} /> : <HomePage onSettings={openSettings} openProject={id => { void navigate(`#/project/${encodeURIComponent(id)}`); }} registerLeaveGuard={registerLeaveGuard} />}
      {showSettings && <SettingsDialog settings={settings} onSaved={setSettings} onClose={closeSettings} />}
    </Suspense>
  </>;
}
