import { useCallback, useEffect, useRef, useState } from 'react';
import { slidesService, askSlides } from '../../app/composition';
import type { SlidesWorkspace } from '../../app/presentation/slidesPorts';
import type { DeckSession } from '../../app/presentation/DeckSession';
import type { DeckMutation, Deck } from '../../modules/presentation/editing/schema';
import type { FigureResources } from '../../app/paper/figureResources';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { SlidesProposal } from '../../app/assistant/slidesAssistant';
import { setDirty, beginActivity, type RegisterLeaveGuard } from '../../app/activity';
import { errorMessage } from '../controls';
type Draft = { version: number; value: string; mutation: DeckMutation };
export function useSlidesController(input: {
  id: string;
  settings: ModelSettings;
  autoStart?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const [data, setData] = useState<SlidesWorkspace>();
  const [session, setSession] = useState<DeckSession>();
  const [deck, setDeck] = useState<Deck>();
  const [resources, setResources] = useState<FigureResources>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('已保存');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [proposal, setProposal] = useState<SlidesProposal>();
  const [answer, setAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const draftsRef = useRef<Record<string, Draft>>({});
  const sessionRef = useRef<DeckSession | undefined>(undefined);
  const saveRef = useRef<Promise<void> | undefined>(undefined);
  const task = useRef<AbortController | undefined>(undefined);
  const ai = useRef<AbortController | undefined>(undefined);
  const lifetime = useRef(0);
  const resourceRef = useRef<FigureResources | undefined>(undefined);
  const dirtyKey = `slides:${input.id}`;
  useEffect(() => {
    if (deck)
      setData((previous) =>
        previous
          ? {
              ...previous,
              current: deck,
              candidateStale:
                previous.candidateStale ||
                (previous.project.candidate?.base.current &&
                (previous.project.candidate.base.current.deckId !== deck.id ||
                  previous.project.candidate.base.current.revision !== deck.revision)
                  ? '当前稿已修改；这份新稿只能查看。'
                  : undefined),
            }
          : previous,
      );
  }, [deck]);
  const accept = useCallback((state: SlidesWorkspace) => {
    ai.current?.abort();
    ai.current = undefined;
    setAiBusy(false);
    setProposal(undefined);
    resourceRef.current?.dispose();
    const resource = slidesService.resources(state);
    resourceRef.current = resource;
    setResources(resource);
    setData(state);
    const next = slidesService.session(state);
    sessionRef.current = next;
    setSession(next);
    setDeck(next?.current);
  }, []);
  const flush = useCallback(async () => {
    if (saveRef.current) await saveRef.current;
    const captured = { ...draftsRef.current };
    const values = Object.values(captured);
    const current = sessionRef.current;
    if (!values.length || !current) return;
    const done = beginActivity();
    setStatus('正在保存…');
    const work = (async () => {
      try {
        await current.commit(
          { type: 'deck' },
          values.map((v) => v.mutation),
          '编辑幻灯片与讲稿',
        );
        for (const [key, value] of Object.entries(captured))
          if (draftsRef.current[key]?.version === value.version) delete draftsRef.current[key];
        current.releaseDraft(Math.max(...values.map((v) => v.version)));
        setDrafts({ ...draftsRef.current });
        setDirty(dirtyKey, Object.keys(draftsRef.current).length > 0);
        setDeck(current.current);
        setStatus(current.dirty ? '未保存输入' : '已保存');
      } catch (cause) {
        setStatus('保存失败，输入保留');
        throw cause;
      } finally {
        done();
      }
    })();
    saveRef.current = work;
    try {
      await work;
    } finally {
      if (saveRef.current === work) saveRef.current = undefined;
    }
  }, [dirtyKey]);
  const generate = useCallback(async () => {
    await flush();
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setRunning(true);
    setPaused(false);
    setError('');
    try {
      const state = await slidesService.generate({
        projectId: input.id,
        settings: input.settings,
        signal: controller.signal,
        onStage: setStatus,
        assertActive() {
          controller.signal.throwIfAborted();
          if (task.current !== controller || sessionRef.current?.dirty) throw new Error('生成已失效。');
        },
      });
      if (task.current === controller) {
        accept(state);
        setStatus(state.candidate ? '完整新稿已保存，等待查看' : '完整幻灯片已保存');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (task.current === controller) {
        task.current = undefined;
        setRunning(false);
      }
    }
  }, [accept, flush, input.id, input.settings]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: One project opening consumes one explicit entry authorization.
  useEffect(() => {
    const epoch = ++lifetime.current;
    slidesService
      .open(input.id)
      .then((state) => {
        if (epoch !== lifetime.current) return;
        accept(state);
        if (input.autoStart) {
          input.onStarted?.();
          void generate();
        }
      })
      .catch((cause) => {
        if (epoch === lifetime.current) setError(errorMessage(cause));
      });
    return () => {
      lifetime.current++;
      task.current?.abort();
      ai.current?.abort();
      resourceRef.current?.dispose();
      setDirty(dirtyKey, false);
    };
  }, [input.id, accept]);
  useEffect(() => {
    input.registerLeaveGuard?.(async () => {
      await flush();
      if (Object.keys(draftsRef.current).length || sessionRef.current?.dirty) throw new Error('请先保存当前输入。');
      task.current?.abort();
      ai.current?.abort();
    });
    return () => input.registerLeaveGuard?.();
  }, [input.registerLeaveGuard, flush]);
  function changedDraft(key: string, value: string, mutation: DeckMutation) {
    const current = sessionRef.current;
    if (!current) return;
    ai.current?.abort();
    setAiBusy(false);
    task.current?.abort();
    task.current = undefined;
    setRunning(false);
    draftsRef.current[key] = { value, mutation, version: current.registerDraft() };
    setDrafts({ ...draftsRef.current });
    setDirty(dirtyKey, true);
    setStatus('未保存输入');
  }
  async function act(work: () => Promise<unknown>) {
    try {
      await flush();
      await work();
      setDeck(sessionRef.current?.current);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function commit(mutations: DeckMutation[], summary: string) {
    await flush();
    const current = sessionRef.current;
    if (!current) return;
    ai.current?.abort();
    setAiBusy(false);
    const done = beginActivity();
    setStatus('正在保存…');
    try {
      await current.commit({ type: 'deck' }, mutations, summary);
      setDeck(current.current);
      setStatus('已保存');
    } finally {
      done();
    }
  }
  async function send(question: string, mode: 'ask' | 'edit', slideIds?: string[]) {
    await flush();
    const current = sessionRef.current;
    if (!current || !data || ai.current) return;
    const controller = new AbortController();
    ai.current = controller;
    setAiBusy(true);
    setAnswer('');
    setProposal(undefined);
    try {
      const result = await askSlides({
        session: current,
        paper: data.paper,
        settings: input.settings,
        question,
        mode,
        slideIds,
        signal: controller.signal,
        onText: setAnswer,
      });
      if (ai.current === controller) {
        setAnswer(result.answer);
        setProposal(result.proposal);
      }
    } finally {
      if (ai.current === controller) {
        ai.current = undefined;
        setAiBusy(false);
      }
    }
  }
  async function applyProposal() {
    if (!proposal || !sessionRef.current) return;
    sessionRef.current.assertCapture(proposal.capture);
    await sessionRef.current.commit(proposal.args.scope, proposal.args.mutations, proposal.args.summary, undefined, {
      isTaskActive: () => !sessionRef.current?.dirty,
    });
    setDeck(sessionRef.current.current);
    setProposal(undefined);
    setStatus('AI 修改已保存，可撤销');
  }
  async function exportDeck() {
    await flush();
    if (task.current || !sessionRef.current) return;
    const controller = new AbortController();
    task.current = controller;
    setRunning(true);
    try {
      await slidesService.export({
        projectId: input.id,
        deck: sessionRef.current.current,
        signal: controller.signal,
        onStage: setStatus,
      });
      setStatus('PPTX 已导出');
    } finally {
      if (task.current === controller) {
        task.current = undefined;
        setRunning(false);
      }
    }
  }
  function stop(pause = false) {
    task.current?.abort();
    task.current = undefined;
    setRunning(false);
    setPaused(pause);
    setStatus(pause ? '已暂停，可手动继续' : '已取消，保存成果保留');
  }
  return {
    data,
    session,
    deck,
    resources,
    error,
    status,
    running,
    paused,
    drafts,
    proposal,
    answer,
    aiBusy,
    accept,
    act,
    flush,
    commit,
    generate,
    changedDraft,
    send,
    applyProposal,
    exportDeck,
    stop,
    setProposal,
    cancelAi() {
      ai.current?.abort();
      ai.current = undefined;
      setAiBusy(false);
    },
    history: async (direction: 'undo' | 'redo') => {
      await flush();
      await sessionRef.current?.[direction]();
      setDeck(sessionRef.current?.current);
      setStatus('已保存');
    },
    value: (key: string, fallback: string) => drafts[key]?.value ?? fallback,
  };
}
