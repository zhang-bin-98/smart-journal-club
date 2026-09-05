import { lazy, Suspense, useEffect, useState } from 'react';
import { HomePage } from './HomePage';
import { DEFAULT_SETTINGS, type ModelSettings } from '../model';
import { loadSettings } from '../storage';
import { errorMessage } from './controls';
const SettingsDialog = lazy(() => import('./SettingsDialog').then(module => ({ default: module.SettingsDialog })));
const ProjectPage = lazy(() => import('./ProjectPage').then(module => ({ default: module.ProjectPage })));
const FixturePage = import.meta.env.DEV ? lazy(() => import('./FixturePage')) : undefined;
export function App() {
  const [hash, setHash] = useState(location.hash);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; loadSettings().then(value => { if (active) setSettings(value); }, cause => { if (active) setError(errorMessage(cause)); }); return () => { active = false; }; }, []);
  useEffect(() => { const update = () => setHash(location.hash); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  const projectId = /^#\/project\/([^/]+)$/.exec(hash)?.[1];
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted">正在打开…</p>}>
    {error && <p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
    {hash === '#/fixture' && FixturePage ? <FixturePage /> : projectId ? <ProjectPage key={projectId} id={decodeURIComponent(projectId)} settings={settings} onSettings={() => setShowSettings(true)} onLeave={() => { location.hash = '/'; }} /> : <HomePage onSettings={() => setShowSettings(true)} openProject={id => { location.hash = `/project/${encodeURIComponent(id)}`; }} />}
    {showSettings && <SettingsDialog settings={settings} onSaved={setSettings} onClose={() => setShowSettings(false)} />}
  </Suspense>;
}
