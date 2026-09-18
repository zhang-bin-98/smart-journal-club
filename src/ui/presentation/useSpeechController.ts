import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { presentationSessions } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { RegisterLeaveGuard } from '../../app/activity';

export function useSpeechController(input: {
  id: string;
  settings: ModelSettings;
  autoStart?: boolean;
  preferPlan?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const controller = useMemo(() => presentationSessions.speech(input.id), [input.id]);
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const state = useSyncExternalStore(controller.session.subscribe, controller.session.snapshot);
  const started = useRef(false);
  const generate = useCallback(() => controller.generate(input.settings), [controller, input.settings]);
  useEffect(() => {
    let active = true;
    void controller.load(input.preferPlan).then(() => {
      if (active && input.autoStart && !started.current) {
        started.current = true;
        input.onStarted?.();
        void generate().catch(controller.setError);
      }
    });
    return () => {
      active = false;
    };
  }, [controller, input.preferPlan, input.autoStart, input.onStarted, generate]);
  useEffect(() => {
    input.registerLeaveGuard?.(controller.leave);
    return () => input.registerLeaveGuard?.();
  }, [controller, input.registerLeaveGuard]);
  return { ...controller, ...view, state, generate };
}
export type SpeechController = ReturnType<typeof useSpeechController>;
