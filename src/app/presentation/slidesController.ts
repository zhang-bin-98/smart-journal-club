import type { createSlidesService } from './service';
import type { SlidesWorkspace } from './slidesPorts';
import type { DeckSession } from './DeckSession';
import type { Deck, DeckMutation } from '../../modules/presentation/editing/schema';
import { ContentError } from '../../modules/presentation/content';
import type { FigureResources } from '../paper/figureResources';
import type { ModelSettings } from '../settings/modelSettings';
import type { createSlidesAssistant, SlidesProposal } from '../assistant/slidesAssistant';

type Draft = { version: number; value: string; mutation: DeckMutation };
type State = {
  data?: SlidesWorkspace;
  session?: DeckSession;
  deck?: Deck;
  resources?: FigureResources;
  error: string;
  status: string;
  running: boolean;
  paused: boolean;
  drafts: Record<string, Draft>;
  proposal?: SlidesProposal;
  answer: string;
  aiBusy: boolean;
};
/** 项目持有任务与编辑会话；视图只订阅，不因卸载取消生成或清空 Undo。 */
export function createSlidesController(
  id: string,
  dependencies: {
    service: ReturnType<typeof createSlidesService<FigureResources>>;
    ask: ReturnType<typeof createSlidesAssistant>;
    beforeEdit: () => void;
    assertAvailable: () => void;
  },
) {
  const { service } = dependencies;
  let state: State = {
    error: '',
    status: '已保存',
    running: false,
    paused: false,
    drafts: {},
    answer: '',
    aiBusy: false,
  };
  let closed = false;
  let loading: Promise<void> | undefined;
  let saving: Promise<void> | undefined;
  let task: AbortController | undefined;
  let ai: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<State>) => {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const setError = (cause: unknown) => update({ error: cause instanceof Error ? cause.message : '操作失败，请重试。' });
  function cancelAi() {
    ai?.abort();
    ai = undefined;
    update({ aiBusy: false });
  }
  function refresh() {
    const deck = state.session?.current;
    const data = state.data;
    update({
      deck,
      data: data
        ? {
            ...data,
            current: deck,
            candidateStale:
              data.candidateStale ||
              (data.project.candidate?.base.current &&
              (data.project.candidate.base.current.deckId !== deck?.id ||
                data.project.candidate.base.current.revision !== deck?.revision)
                ? '当前稿已修改；这份新稿只能查看。'
                : undefined),
          }
        : undefined,
      status: state.session?.dirty ? '未保存输入' : '已保存',
    });
  }
  function accept(data: SlidesWorkspace) {
    if (closed) return;
    state.session?.assertClean();
    const unchanged =
      state.session?.current.id === data.current?.id && state.session?.current.revision === data.current?.revision;
    if (!unchanged) {
      cancelAi();
      state.session?.close();
    }
    // 相同版本重开保留会话与候选；切版或外部内容写入才重建。
    const samePaper = state.data?.paper.id === data.paper.id && state.data?.paper.revision === data.paper.revision;
    if (!samePaper) state.resources?.dispose();
    update({
      data,
      session: unchanged ? state.session : service.session(data),
      deck: unchanged ? state.session?.current : data.current,
      resources: samePaper ? state.resources : service.resources(data),
      proposal: unchanged ? state.proposal : undefined,
    });
  }
  async function load() {
    if (state.running || state.session?.dirty) return;
    if (loading) return loading;
    const work = (async () => {
      try {
        accept(await service.open(id));
      } catch (cause) {
        setError(cause);
      }
    })();
    loading = work;
    try {
      await work;
    } finally {
      if (loading === work) loading = undefined;
    }
  }
  async function flush() {
    while (saving) await saving;
    const captured = state.drafts;
    const values = Object.values(captured);
    const session = state.session;
    if (!values.length || !session) return;
    update({ status: '正在保存…' });
    const work = (async () => {
      try {
        await session.commit(
          { type: 'deck' },
          values.map((v) => v.mutation),
          '编辑幻灯片与讲稿',
          undefined,
          {
            editVersion: Math.max(...values.map((v) => v.version)),
          },
        );
        const remaining = { ...state.drafts };
        for (const [key, value] of Object.entries(captured))
          if (remaining[key]?.version === value.version) delete remaining[key];
        update({ drafts: remaining, proposal: undefined });
        refresh();
      } catch (cause) {
        update({ status: '保存失败，输入保留' });
        throw cause;
      }
    })();
    saving = work;
    try {
      await work;
    } finally {
      if (saving === work) saving = undefined;
    }
  }
  async function leave() {
    await flush();
    state.session?.assertClean();
  }
  function stop(pause = false) {
    if (!task) return;
    task.abort();
    task = undefined;
    update({ running: false, paused: pause, status: pause ? '已暂停，可手动继续' : '已取消，保存成果保留' });
  }
  function registerDraft(target = 'content') {
    const session = state.session;
    if (!session) throw new ContentError('missing-deck', '没有可编辑的稿件。');
    const version = session.registerDraft(target);
    dependencies.beforeEdit();
    cancelAi();
    update({ proposal: undefined, status: '未保存输入' });
    return version;
  }
  async function commit(mutations: DeckMutation[], summary: string, editVersion?: number) {
    if (editVersion === undefined) await leave();
    const session = state.session;
    if (!session) return;
    dependencies.beforeEdit();
    cancelAi();
    await session.commit({ type: 'deck' }, mutations, summary, undefined, { editVersion });
    update({ proposal: undefined });
    refresh();
  }
  async function generate(settings: ModelSettings) {
    await leave();
    if (task || closed) return;
    dependencies.assertAvailable();
    const controller = new AbortController();
    task = controller;
    update({ running: true, paused: false, error: '' });
    try {
      const data = await service.generate({
        projectId: id,
        settings,
        signal: controller.signal,
        onStage: (status) => {
          if (task === controller) update({ status });
        },
        assertActive() {
          controller.signal.throwIfAborted();
          if (closed || task !== controller) throw new ContentError('inactive-task', '生成已失效。');
          state.session?.assertClean();
        },
      });
      if (task === controller && !closed) {
        accept(data);
        update({ status: data.candidate ? '完整新稿已保存，等待查看' : '完整幻灯片已保存' });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      if (task === controller) {
        task = undefined;
        update({ running: false });
      }
    }
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    accept,
    flush,
    leave,
    generate,
    commit,
    registerDraft,
    cancelAi,
    stop,
    setError,
    setProposal: (proposal?: SlidesProposal) => update({ proposal }),
    async act(work: () => Promise<unknown>) {
      try {
        await leave();
        await work();
        refresh();
        update({ error: '' });
      } catch (cause) {
        setError(cause);
      }
    },
    changedDraft(key: string, value: string, mutation: DeckMutation) {
      const version = registerDraft();
      update({ drafts: { ...state.drafts, [key]: { value, mutation, version } } });
    },
    async discardDraft(version: number) {
      await state.session?.discardDraft(version);
      refresh();
    },
    async history(direction: 'undo' | 'redo') {
      await leave();
      dependencies.beforeEdit();
      await state.session?.[direction]();
      update({ proposal: undefined });
      refresh();
    },
    async send(settings: ModelSettings, question: string, mode: 'ask' | 'edit', slideIds?: string[]) {
      await leave();
      const { session, data } = state;
      if (!session || !data || ai || closed) return;
      const controller = new AbortController();
      ai = controller;
      update({ aiBusy: true, answer: '', proposal: undefined });
      try {
        const result = await dependencies.ask({
          session,
          paper: data.paper,
          settings,
          question,
          mode,
          slideIds,
          signal: controller.signal,
          onText: (answer) => {
            if (ai === controller) update({ answer });
          },
        });
        if (ai === controller) update({ answer: result.answer, proposal: result.proposal });
      } finally {
        if (ai === controller) {
          ai = undefined;
          update({ aiBusy: false });
        }
      }
    },
    async applyProposal() {
      const { session, proposal } = state;
      if (!session || !proposal) return;
      session.assertCapture(proposal.capture);
      dependencies.beforeEdit();
      await session.commit(proposal.args.scope, proposal.args.mutations, proposal.args.summary);
      refresh();
      update({ proposal: undefined, status: 'AI 修改已保存，可撤销' });
    },
    async exportDeck() {
      await leave();
      if (task || !state.session || closed) return;
      dependencies.assertAvailable();
      const controller = new AbortController();
      task = controller;
      update({ running: true });
      try {
        await service.export({
          projectId: id,
          deck: state.session.current,
          signal: controller.signal,
          onStage: (status) => {
            if (task === controller) update({ status });
          },
        });
        if (task === controller) update({ status: 'PPTX 已导出' });
      } finally {
        if (task === controller) {
          task = undefined;
          update({ running: false });
        }
      }
    },
    clearLocal() {
      cancelAi();
      state.session?.clearHistory();
      update({ proposal: undefined, answer: '' });
    },
    dispose() {
      closed = true;
      task?.abort();
      ai?.abort();
      state.session?.close();
      state.resources?.dispose();
      listeners.clear();
    },
  };
}
export type SlidesController = ReturnType<typeof createSlidesController>;
