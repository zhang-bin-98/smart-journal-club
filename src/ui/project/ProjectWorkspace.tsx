import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { LeaveGuard, RegisterLeaveGuard } from '../../app/activity';
import { analysisService, presentationSessions } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { WorkspaceStep } from '../../modules/project/model';
import { Button, errorMessage } from '../controls';

const AnalysisPage = lazy(() => import('../paper/AnalysisPage').then((module) => ({ default: module.AnalysisPage })));
const FigureReviewPage = lazy(() =>
  import('../paper/FigureReviewPage').then((module) => ({ default: module.FigureReviewPage })),
);
const SpeechPage = lazy(() => import('../presentation/SpeechPage').then((module) => ({ default: module.SpeechPage })));
const SlidesPage = lazy(() => import('../presentation/SlidesPage').then((module) => ({ default: module.SlidesPage })));

export function ProjectWorkspace({
  id,
  settings,
  onSettings,
  onLeave,
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
  useEffect(() => presentationSessions.attach(id), [id]);
  const [step, setStep] = useState<WorkspaceStep>();
  const [error, setError] = useState('');
  const [startSpeech, setStartSpeech] = useState(false);
  const [startSlides, setStartSlides] = useState(false);
  const [preferPlan, setPreferPlan] = useState(false);
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
        {step === 'slides' ? (
          <SlidesPage
            id={id}
            settings={settings}
            onSettings={onSettings}
            onLeave={onLeave}
            onStep={(next) => {
              setPreferPlan(false);
              void changeStep(next);
            }}
            autoStart={startSlides}
            onStarted={() => setStartSlides(false)}
            onOpenPlan={() => {
              setPreferPlan(true);
              setStartSpeech(false);
              void changeStep('outline-speech');
            }}
            onRegenerate={() => {
              setPreferPlan(true);
              setStartSpeech(true);
              void changeStep('outline-speech');
            }}
            registerLeaveGuard={register}
          />
        ) : step === 'outline-speech' ? (
          <SpeechPage
            id={id}
            settings={settings}
            onSettings={onSettings}
            onLeave={onLeave}
            onStep={(next) => void changeStep(next)}
            preferPlan={preferPlan}
            onNext={() => {
              setStartSlides(true);
              void changeStep('slides');
            }}
            autoStart={startSpeech}
            onStarted={() => setStartSpeech(false)}
            registerLeaveGuard={register}
          />
        ) : step === 'figure-review' ? (
          <FigureReviewPage
            onGenerate={() => {
              setStartSpeech(true);
              void changeStep('outline-speech');
            }}
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
