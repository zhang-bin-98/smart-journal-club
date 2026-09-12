import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { createSpeechSession, generateSpeech, createSpeechResources } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ContentCommand } from '../../modules/presentation/content';
import { ContentError } from '../../modules/presentation/content';
import type { FigureResources } from '../../app/paper/figureResources';
import { errorMessage } from '../controls';
type Draft = { target: string; editId: string; command: ContentCommand; version: number };
export function useSpeechController(input: {
  id: string;
  settings: ModelSettings;
  autoStart?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const session = useMemo(() => createSpeechSession(input.id), [input.id]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftRef = useRef<Record<string, Draft>>({});
  const flushing = useRef<Promise<void> | undefined>(undefined);
  const task = useRef<AbortController | undefined>(undefined);
  const [resources, setResources] = useState<FigureResources>();
  const [strategyId, setStrategyId] = useState<string>();
  const flush = useCallback(async () => {
    if (flushing.current) await flushing.current;
    const captured = { ...draftRef.current };
    const values = Object.values(captured);
    if (!values.length) return;
    const work = session.commit(
      values.map((v) => v.command),
      values[0].editId,
    );
    flushing.current = work;
    try {
      await work;
      for (const [key, value] of Object.entries(captured)) {
        if (draftRef.current[key]?.version === value.version) delete draftRef.current[key];
      }
      setDrafts({ ...draftRef.current });
    } finally {
      if (flushing.current === work) flushing.current = undefined;
    }
  }, [session]);
  const generate = useCallback(async () => {
    await flush();
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setRunning(true);
    setPaused(false);
    setError('');
    try {
      await generateSpeech({
        projectId: input.id,
        settings: input.settings,
        signal: controller.signal,
        preferences: strategyId ? { ...session.snapshot().data!.project.preferences, strategyId } : undefined,
        assertActive() {
          if (task.current !== controller || controller.signal.aborted || session.snapshot().dirty)
            throw new ContentError('inactive-task', '生成已停止。');
        },
        onStage: setStage,
      });
      await session.load();
      setStage('完整讲稿已保存，可继续编辑');
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (task.current === controller) {
        task.current = undefined;
        setRunning(false);
      }
    }
  }, [flush, input.id, input.settings, session, strategyId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一次项目打开仅消费一次显式启动授权。
  useEffect(() => {
    let active = true;
    session
      .load()
      .then(() => {
        if (active && input.autoStart) {
          input.onStarted?.();
          void generate();
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      task.current?.abort();
      task.current = undefined;
      session.close();
    };
  }, [session]);
  useEffect(() => {
    input.registerLeaveGuard?.(async () => {
      await flush();
      await session.leave();
      task.current?.abort();
      task.current = undefined;
    });
    return () => input.registerLeaveGuard?.();
  }, [flush, input.registerLeaveGuard, session]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 固定文件资源只随项目身份初始化。
  useEffect(() => {
    let active = true;
    let resource: FigureResources | undefined;
    if (state.data)
      createSpeechResources(input.id)
        .then((value) => {
          resource = value;
          if (active) setResources(value);
          else value.dispose();
        })
        .catch((cause) => {
          if (active) setError(errorMessage(cause));
        });
    return () => {
      active = false;
      resource?.dispose();
    };
  }, [state.data?.project.id, input.id]);
  async function act(work: () => Promise<unknown>) {
    try {
      await flush();
      await work();
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  function change(target: string, command: ContentCommand) {
    try {
      task.current?.abort();
      task.current = undefined;
      setRunning(false);
      const edit = session.register('content');
      const next = { target, command, editId: edit.id, version: edit.version };
      draftRef.current[target] = next;
      setDrafts({ ...draftRef.current });
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  function stop(pause: boolean) {
    task.current?.abort();
    task.current = undefined;
    setRunning(false);
    setPaused(pause);
    setStage(pause ? '生成已暂停，完整成果保留' : '生成已取消，完整成果保留');
  }
  return {
    session,
    state,
    error,
    setError,
    drafts,
    change,
    flush,
    act,
    generate,
    stage,
    running,
    paused,
    stop,
    resources,
    strategyId,
    setStrategyId,
    discard: async () => {
      await session.discard();
      draftRef.current = {};
      setDrafts({});
      setError('');
    },
  };
}
export type SpeechController = ReturnType<typeof useSpeechController>;
