import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { LeaveGuard, RegisterLeaveGuard } from '../../app/activity';
import { analysisService } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { WorkspaceStep } from '../../modules/project/model';
import { Button, errorMessage } from '../controls';

const AnalysisPage = lazy(() => import('../paper/AnalysisPage').then((module) => ({ default: module.AnalysisPage })));
const FigureReviewPage = lazy(() =>
  import('../paper/FigureReviewPage').then((module) => ({ default: module.FigureReviewPage })),
);
const LegacyPage = lazy(() => import('./ProjectPage').then((module) => ({ default: module.ProjectPage })));

export function ProjectWorkspace({
  id,
  settings,
  onSettings,
  onLeave,
  onOpenProject,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  onSettings: () => void;
  onLeave: () => void;
  onOpenProject: (id: string) => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const session = analysisService.session(id);
  const [step, setStep] = useState<WorkspaceStep>();
  const [error, setError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const guard = useRef<LeaveGuard | undefined>(undefined);
  const register = useCallback<RegisterLeaveGuard>(
    (value) => {
      guard.current = value;
      registerLeaveGuard?.(value);
    },
    [registerLeaveGuard],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 显式重试读取当前项目。
  useEffect(() => {
    let active = true;
    session.load().then(
      (data) => {
        if (active) {
          setStep(data.project.lastOpenedStep ?? 'paper-analysis');
          setError('');
        }
      },
      (cause) => {
        if (active) setError(errorMessage(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [session, readAttempt]);
  async function changeStep(next: WorkspaceStep) {
    try {
      await guard.current?.();
      await session.openStep(next);
      setStep(next);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  if (!step)
    return (
      <main className="p-6">
        <Button onClick={onLeave}>返回项目列表</Button>
        <p role={error ? 'alert' : 'status'}>{error || '正在打开项目…'}</p>
        {error && <Button onClick={() => setReadAttempt((value) => value + 1)}>重试读取</Button>}
      </main>
    );
  const legacy = step === 'slides' || step === 'outline-speech';
  return (
    <>
      {error && (
        <p role="alert" className="p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <Suspense
        fallback={
          <p role="status" className="p-6">
            正在打开工作台…
          </p>
        }
      >
        {legacy ? (
          <>
            <div className="flex items-center gap-3 border-b border-line bg-white px-5 py-2">
              <Button onClick={() => void changeStep('paper-analysis')}>论文分析与全部原页</Button>
              <span className="text-xs text-muted">已保存成果</span>
            </div>
            <LegacyPage
              id={id}
              initialStep={step}
              settings={settings}
              onSettings={onSettings}
              onLeave={onLeave}
              onOpenProject={onOpenProject}
              registerLeaveGuard={register}
            />
          </>
        ) : step === 'figure-review' ? (
          <FigureReviewPage
            id={id}
            settings={settings}
            onSettings={onSettings}
            onLeave={onLeave}
            onStep={(next) => void changeStep(next)}
            registerLeaveGuard={register}
          />
        ) : (
          <AnalysisPage
            id={id}
            settings={settings}
            onSettings={onSettings}
            onLeave={onLeave}
            registerLeaveGuard={register}
            onLegacyStep={(next) => void changeStep(next)}
          />
        )}
      </Suspense>
    </>
  );
}
