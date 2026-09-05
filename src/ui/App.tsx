import { lazy, Suspense, useEffect, useState } from 'react';
import { HomePage } from './HomePage';
const ProjectPage = lazy(() => import('./ProjectPage').then(module => ({ default: module.ProjectPage })));
const FixturePage = import.meta.env.DEV ? lazy(() => import('./FixturePage')) : undefined;
export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const update = () => setHash(location.hash); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  const projectId = /^#\/project\/([^/]+)$/.exec(hash)?.[1];
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted">正在打开…</p>}>
    {hash === '#/fixture' && FixturePage ? <FixturePage /> : projectId ? <ProjectPage key={projectId} id={decodeURIComponent(projectId)} onLeave={() => { location.hash = '/'; }} /> : <HomePage openProject={id => { location.hash = `/project/${encodeURIComponent(id)}`; }} />}
  </Suspense>;
}
