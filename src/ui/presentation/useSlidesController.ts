import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { presentationSessions } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { RegisterLeaveGuard } from '../../app/activity';

export function useSlidesController(input: {
  id: string;
  settings: ModelSettings;
  autoStart?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const controller = useMemo(() => presentationSessions.slides(input.id), [input.id]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const started = useRef(false);
  const generate = useCallback(() => controller.generate(input.settings), [controller, input.settings]);
  useEffect(() => {
    let active = true;
    void controller.load().then(() => {
      if (active && input.autoStart && !started.current) {
        started.current = true;
        input.onStarted?.();
        void generate().catch(controller.setError);
      }
    });
    return () => {
      active = false;
    };
  }, [controller, input.autoStart, input.onStarted, generate]);
  useEffect(() => {
    input.registerLeaveGuard?.(controller.leave);
    return () => input.registerLeaveGuard?.();
  }, [controller, input.registerLeaveGuard]);
  return {
    ...controller,
    ...state,
    generate,
    send: (question: string, mode: 'ask' | 'edit', slideIds?: string[]) =>
      controller.send(input.settings, question, mode, slideIds),
    value: (key: string, fallback: string) => state.drafts[key]?.value ?? fallback,
  };
}
