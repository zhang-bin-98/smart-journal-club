import type { FigureConsumer } from './figureImpact';
import {
  applyFigureCommand,
  baselineCommand,
  figureContent,
  type FigureCommand,
  type FigureContent,
} from '../../modules/paper/figureEditing';
import { PaperError, type Paper } from '../../modules/paper/model';
import type { AnalysisProject } from './ports';
import { beginActivity, setDirty } from '../activity';

export type FigureSave = {
  projectId: string;
  paperId: string;
  revision: number;
  reviewRevision: number;
  command: FigureCommand;
  assertCurrent: () => void;
};
export type FigureStore = {
  openProject(id: string): Promise<AnalysisProject>;
  loadConsumers?(id: string): Promise<FigureConsumer[]>;
  saveFigure(input: FigureSave): Promise<AnalysisProject>;
};
export type FigureSnapshot = {
  data?: AnalysisProject;
  consumers?: FigureConsumer[];
  saving: boolean;
  dirty: boolean;
  error?: string;
  canUndo: boolean;
  canRedo: boolean;
  candidate?: { command: FigureCommand; revision: number; label: string; paper: Paper };
};

/** Registration and serialized saves share one authority; failures never advance history. */
export function createFigureSession(projectId: string, store: FigureStore, cancelConflicts: () => void = () => {}) {
  let state: FigureSnapshot = { saving: false, dirty: false, canUndo: false, canRedo: false };
  let edit: { id: string; target: string; draftVersion: number } | undefined;
  let version = 0;
  let closed = false;
  let loadVersion = 0;
  let inFlight: Promise<void> | undefined;
  let task: AbortController | undefined;
  const past: FigureContent[] = [];
  const future: FigureContent[] = [];
  const listeners = new Set<() => void>();
  const key = `figure-edit:${projectId}`;
  function update(patch: Partial<FigureSnapshot>) {
    state = { ...state, ...patch, dirty: !!edit, canUndo: !!past.length, canRedo: !!future.length };
    setDirty(key, !!edit);
    for (const listener of listeners) listener();
  }
  function assertOpen() {
    if (closed || !state.data) throw new PaperError('closed-project', '图源会话尚未打开或已关闭。');
  }
  function invalidateTask() {
    task?.abort();
    task = undefined;
    version++;
  }
  async function save(command: FigureCommand, history: 'edit' | 'undo' | 'redo' | 'enrich' = 'edit') {
    assertOpen();
    if (inFlight) throw new PaperError('save-in-progress', '正在保存上一项修改，请稍后重试。');
    if (command.kind === 'confirm' && edit) throw new PaperError('unsaved-edit', '请先保存或取消正在编辑的内容。');
    if (edit) {
      const allowed =
        edit.target === 'box'
          ? ['box', 'add-panel']
          : edit.target === 'title'
            ? ['add-figure', 'move-region']
            : edit.target === 'label'
              ? ['label']
              : ['associate'];
      if (!allowed.includes(command.kind))
        throw new PaperError('conflicting-edit', '当前编辑范围尚未保存，不能提交其他修改。');
    }
    const data = state.data!;
    const capturedEdit = edit && { ...edit };
    const expected = applyFigureCommand(data.paper, command);
    if (expected === data.paper) {
      edit = undefined;
      update({});
      return;
    }
    const before = figureContent(data.paper);
    const pendingCandidate = state.candidate;
    invalidateTask();
    const done = beginActivity();
    update({ saving: true, error: undefined, candidate: undefined });
    const pending = (async () => {
      try {
        const saved = await store.saveFigure({
          projectId,
          paperId: data.paper.id,
          revision: data.paper.revision,
          reviewRevision: data.paper.figureReview.revision,
          command,
          assertCurrent: () => {
            if (closed) throw new PaperError('closed-project', '项目已关闭，结果未保存。');
          },
        });
        if (history === 'undo') {
          past.pop();
          future.push(before);
        } else if (history === 'redo') {
          future.pop();
          past.push(before);
        } else if (history === 'edit' && command.kind !== 'confirm' && command.kind !== 'refresh-associations') {
          past.push(before);
          future.length = 0;
        }
        if (past.length > 30) past.shift();
        if (edit?.id === capturedEdit?.id && edit?.draftVersion === capturedEdit?.draftVersion) edit = undefined;
        update({ data: saved });
      } catch (cause) {
        update({
          candidate: edit ? undefined : pendingCandidate,
          error: cause instanceof PaperError ? cause.message : '图源保存失败，输入已保留，可重试。',
        });
        throw cause;
      } finally {
        inFlight = undefined;
        update({ saving: false });
        done();
      }
    })();
    inFlight = pending;
    return pending;
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      closed = false;
      const loading = ++loadVersion;
      const data = await store.openProject(projectId);
      const consumers = await store.loadConsumers?.(projectId);
      if (!closed && loading === loadVersion && !edit && !inFlight) {
        update({ data, consumers });
        if (data.paper.figures.some((figure) => figure.captionSourceIds === undefined))
          await save({ kind: 'refresh-associations' });
      }
    },
    register(target: string) {
      assertOpen();
      if (edit && edit.target !== target) throw new PaperError('unsaved-edit', '请先保存或取消当前编辑。');
      if (!edit) edit = { id: crypto.randomUUID(), target, draftVersion: 0 };
      edit.draftVersion++;
      cancelConflicts();
      invalidateTask();
      update({ candidate: undefined });
      return { ...edit };
    },
    async discard() {
      await inFlight;
      edit = undefined;
      update({ error: undefined });
    },
    async leave() {
      await inFlight;
      if (edit) throw new PaperError('unsaved-edit', '图源有未保存输入，请保存或取消后离开。');
      invalidateTask();
    },
    save,
    undo: () => {
      if (edit || !past.length) return Promise.reject(new PaperError('unsaved-edit', '请先保存或取消当前编辑。'));
      return save({ kind: 'restore', content: past[past.length - 1] }, 'undo');
    },
    redo: () => {
      if (edit || !future.length) return Promise.reject(new PaperError('unsaved-edit', '请先保存或取消当前编辑。'));
      return save({ kind: 'restore', content: future[future.length - 1] }, 'redo');
    },
    baseline(figureId: string) {
      assertOpen();
      if (edit || inFlight) throw new PaperError('unsaved-edit', '请先完成当前编辑。');
      update({
        candidate: {
          command: baselineCommand(state.data!.paper, figureId),
          paper: applyFigureCommand(state.data!.paper, baselineCommand(state.data!.paper, figureId)),
          revision: state.data!.paper.revision,
          label: '恢复自动结果',
        },
      });
    },
    async recognize(run: (data: AnalysisProject, signal: AbortSignal) => Promise<FigureCommand>) {
      assertOpen();
      if (edit || inFlight) throw new PaperError('unsaved-edit', '请先完成当前编辑。');
      invalidateTask();
      const captured = version;
      const data = state.data!;
      const controller = new AbortController();
      task = controller;
      const done = beginActivity();
      try {
        const command = await run(data, controller.signal);
        controller.signal.throwIfAborted();
        if (closed || captured !== version || state.data!.paper.revision !== data.paper.revision)
          throw new PaperError('stale-candidate', '图源已编辑，旧候选已丢弃。');
        applyFigureCommand(data.paper, command);
        update({
          candidate: {
            command,
            revision: data.paper.revision,
            label: '重新识别结果',
            paper: applyFigureCommand(data.paper, command),
          },
        });
      } finally {
        if (task === controller) task = undefined;
        done();
      }
    },
    async enrich(run: (data: AnalysisProject, signal: AbortSignal) => Promise<FigureCommand | undefined>) {
      assertOpen();
      if (edit || inFlight) return;
      invalidateTask();
      const captured = version;
      const controller = new AbortController();
      task = controller;
      const done = beginActivity();
      try {
        const command = await run(state.data!, controller.signal);
        controller.signal.throwIfAborted();
        if (!command || edit || captured !== version) return;
        await save(command, 'enrich');
      } finally {
        if (task === controller) task = undefined;
        done();
      }
    },
    async applyCandidate() {
      const candidate = state.candidate;
      if (!candidate || edit || candidate.revision !== state.data?.paper.revision)
        throw new PaperError('stale-candidate', '候选已过期，请重新识别。');
      await save(candidate.command);
    },
    discardCandidate() {
      invalidateTask();
      update({ candidate: undefined });
    },
    cancelRecognition: invalidateTask,
    close() {
      closed = true;
      invalidateTask();
      setDirty(key, false);
      listeners.clear();
    },
  };
}
export type FigureSession = ReturnType<typeof createFigureSession>;
