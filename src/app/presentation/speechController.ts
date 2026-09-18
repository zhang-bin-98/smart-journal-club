import type { OutlineSession } from './OutlineSession';
import type { ModelSettings } from '../settings/modelSettings';
import type { ContentCommand } from '../../modules/presentation/content';
import { ContentError } from '../../modules/presentation/content';
import type { FigureResources } from '../paper/figureResources';
import type { prepareOutline } from '../workflows/prepareOutline';
import {
  applySpeechProposal,
  type createSpeechAssistant,
  type SpeechProposal,
  type SpeechScope,
} from '../assistant/speechAssistant';

type Draft = { target: string; editId: string; command: ContentCommand; version: number };
type State = {
  error: string;
  stage: string;
  running: boolean;
  paused: boolean;
  drafts: Record<string, Draft>;
  resources?: FigureResources;
  strategyId?: string;
  answer: string;
  proposal?: SpeechProposal;
  label: string;
  aiBusy: boolean;
};
/** 讲稿会话、生成和 AI 候选随项目保留；内容版本改变才失效局部提案。 */
export function createSpeechController(
  id: string,
  dependencies: {
    session: (id: string, preferPlan: () => boolean) => OutlineSession;
    resources: (id: string) => Promise<FigureResources>;
    generate: (
      input: Omit<Parameters<typeof prepareOutline>[0], 'store' | 'requests' | 'image' | 'refreshEvidence' | 'prompts'>,
    ) => Promise<unknown>;
    ask: ReturnType<typeof createSpeechAssistant>;
    beforeEdit: () => void;
    assertAvailable: () => void;
  },
) {
  let preferPlan = false;
  const session = dependencies.session(id, () => preferPlan);
  let state: State = {
    error: '',
    stage: '',
    running: false,
    paused: false,
    drafts: {},
    answer: '',
    label: '',
    aiBusy: false,
  };
  let closed = false;
  let loading: Promise<void> | undefined;
  let flushing: Promise<void> | undefined;
  let task: AbortController | undefined;
  let ai: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<State>) => {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const setError = (cause: unknown) => update({ error: cause instanceof Error ? cause.message : String(cause) });
  function cancelAi() {
    ai?.abort();
    ai = undefined;
    update({ aiBusy: false });
  }
  let previousTarget = session.snapshot().data?.target;
  const unsubscribe = session.subscribe(() => {
    const snapshot = session.snapshot();
    const target = snapshot.data?.target;
    if (
      snapshot.dirty ||
      previousTarget?.id !== target?.id ||
      previousTarget?.kind !== target?.kind ||
      previousTarget?.revision !== target?.revision ||
      snapshot.data?.stale
    ) {
      cancelAi();
      update({ proposal: undefined });
    }
    previousTarget = target;
  });
  async function load(preference?: boolean) {
    if (closed || state.running || session.snapshot().dirty) return;
    if (loading) return loading;
    if (preference !== undefined) preferPlan = preference;
    const work = (async () => {
      await session.load();
      if (!state.resources && !closed) {
        const resources = await dependencies.resources(id);
        if (closed) resources.dispose();
        else update({ resources });
      }
    })();
    loading = work;
    try {
      await work;
    } catch (cause) {
      setError(cause);
    } finally {
      if (loading === work) loading = undefined;
    }
  }
  async function flush() {
    while (flushing) await flushing;
    const captured = state.drafts;
    const values = Object.values(captured);
    if (!values.length) return;
    const work = session.commit(
      values.map((v) => v.command),
      values[0].editId,
    );
    flushing = work;
    try {
      await work;
      const remaining = { ...state.drafts };
      for (const [key, value] of Object.entries(captured))
        if (remaining[key]?.version === value.version) delete remaining[key];
      update({ drafts: remaining });
    } finally {
      if (flushing === work) flushing = undefined;
    }
  }
  async function leave() {
    await flush();
    await session.leave();
  }
  function stop(pause = false) {
    if (!task) return;
    task.abort();
    task = undefined;
    update({ running: false, paused: pause, stage: pause ? '生成已暂停，完整成果保留' : '生成已取消，完整成果保留' });
  }
  async function act(work: () => Promise<unknown>) {
    try {
      await leave();
      await work();
      update({ error: '' });
    } catch (cause) {
      setError(cause);
    }
  }
  return {
    session,
    load,
    flush,
    leave,
    stop,
    act,
    setError,
    cancelAi,
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setStrategyId: (strategyId?: string) => update({ strategyId }),
    setProposal: (proposal?: SpeechProposal) => update({ proposal }),
    change(target: string, command: ContentCommand) {
      try {
        const edit = session.register('content');
        dependencies.beforeEdit();
        const next = { target, command, editId: edit.id, version: edit.version };
        update({ drafts: { ...state.drafts, [target]: next }, error: '' });
      } catch (cause) {
        setError(cause);
      }
    },
    async discard() {
      await session.discard();
      update({ drafts: {}, error: '' });
    },
    async generate(settings: ModelSettings) {
      await leave();
      if (task || closed) return;
      dependencies.assertAvailable();
      const controller = new AbortController();
      task = controller;
      update({ running: true, paused: false, error: '' });
      try {
        await dependencies.generate({
          projectId: id,
          settings,
          signal: controller.signal,
          preferences: state.strategyId
            ? { ...session.snapshot().data!.project.preferences, strategyId: state.strategyId }
            : undefined,
          assertActive() {
            if (closed || task !== controller || controller.signal.aborted || session.snapshot().dirty)
              throw new ContentError('inactive-task', '生成已停止。');
          },
          onStage: (stage) => {
            if (task === controller) update({ stage });
          },
        });
        if (task === controller && !closed) {
          preferPlan = true;
          await session.load();
          update({ stage: '完整讲稿已保存，可继续编辑' });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause);
      } finally {
        if (task === controller) {
          task = undefined;
          update({ running: false });
        }
      }
    },
    async send(input: {
      settings: ModelSettings;
      question: string;
      mode: 'ask' | 'modify';
      scope: SpeechScope;
      label: string;
    }) {
      await leave();
      if (closed || ai) return;
      const controller = new AbortController();
      ai = controller;
      update({ aiBusy: true, answer: '', proposal: undefined, label: input.label });
      try {
        const result = await dependencies.ask({
          ...input,
          session,
          signal: controller.signal,
          onText: (answer) => {
            if (ai === controller) update({ answer });
          },
        });
        if (ai === controller) update({ answer: result.answer, proposal: result.proposal });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause);
      } finally {
        if (ai === controller) {
          ai = undefined;
          update({ aiBusy: false });
        }
      }
    },
    async applyProposal() {
      if (!state.proposal) return;
      dependencies.beforeEdit();
      await applySpeechProposal(session, state.proposal);
      update({ proposal: undefined });
    },
    clearLocal() {
      cancelAi();
      session.clearHistory();
      update({ proposal: undefined, answer: '', label: '' });
    },
    dispose() {
      closed = true;
      task?.abort();
      ai?.abort();
      unsubscribe();
      session.close();
      state.resources?.dispose();
      listeners.clear();
    },
  };
}
export type SpeechController = ReturnType<typeof createSpeechController>;
