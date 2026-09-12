import {
  applyContentCommands,
  ContentError,
  type Content,
  type ContentCommand,
} from '../../modules/presentation/content';
import type { SpeechStore, SpeechTarget, SpeechWorkspace } from './ports';
import { beginActivity, setDirty } from '../activity';
export type SpeechSnapshot = {
  data?: SpeechWorkspace;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error?: string;
};
/** 保存与撤销成功后才推进会话；保存期间的新输入继续保留编辑登记。 */
export function createOutlineSession(projectId: string, store: SpeechStore) {
  let state: SpeechSnapshot = { dirty: false, saving: false, canUndo: false, canRedo: false };
  let closed = false;
  let epoch = 0;
  let edit: { id: string; target: string; version: number } | undefined;
  let pending: Promise<void> | undefined;
  const past: SpeechTarget[] = [];
  const future: SpeechTarget[] = [];
  const listeners = new Set<() => void>();
  const key = 'speech:' + projectId;
  function update(patch: Partial<SpeechSnapshot>) {
    state = { ...state, ...patch, dirty: !!edit, canUndo: !!past.length, canRedo: !!future.length };
    setDirty(key, !!edit);
    for (const listener of listeners) listener();
  }
  function target(): SpeechTarget {
    if (closed || !state.data?.target) throw new ContentError('missing-target', '没有可编辑的讲稿。');
    if (state.data.stale) throw new ContentError('stale-target', '计划基准已变化，请重新生成。');
    return state.data.target;
  }
  async function save(
    content: Content,
    history: 'edit' | 'undo' | 'redo',
    editId?: string,
    restoreAssignments?: Record<string, string[]>,
  ) {
    const captured = target();
    if (pending) throw new ContentError('saving', '上一项修改正在保存。');
    if (edit && edit.id !== editId) throw new ContentError('dirty-target', '请先保存正在编辑的文字。');
    const capturedEdit = edit && { ...edit };
    const savedEpoch = epoch;
    const done = beginActivity();
    update({ saving: true, error: undefined });
    const work = (async () => {
      try {
        const data = await store.save({
          projectId,
          target: structuredClone(captured),
          content,
          restoreAssignments,
          requestId: crypto.randomUUID(),
          assertActive() {
            if (closed) throw new ContentError('closed', '项目已关闭。');
            if (!capturedEdit && epoch !== savedEpoch)
              throw new ContentError('dirty-target', '提案期间开始了人工编辑。');
          },
        });
        if (history === 'undo') {
          past.pop();
          future.push(structuredClone(captured));
        } else if (history === 'redo') {
          future.pop();
          past.push(structuredClone(captured));
        } else {
          past.push(structuredClone(captured));
          future.length = 0;
        }
        if (past.length > 20) past.shift();
        if (future.length > 20) future.shift();
        if (edit?.id === capturedEdit?.id && edit?.version === capturedEdit?.version) edit = undefined;
        epoch++;
        update({ data });
      } catch (cause) {
        update({ error: cause instanceof ContentError ? cause.message : '讲稿保存失败，输入已保留，可重试。' });
        throw cause;
      } finally {
        pending = undefined;
        update({ saving: false });
        done();
      }
    })();
    pending = work;
    return work;
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
      const version = ++epoch;
      const data = await store.open(projectId);
      if (!closed && epoch === version && !edit && !pending) {
        const old = state.data?.target;
        if (old && (old.id !== data.target?.id || old.revision !== data.target?.revision)) {
          past.length = 0;
          future.length = 0;
        }
        update({ data, error: undefined });
      }
    },
    register(id: string) {
      target();
      if (edit && edit.target !== id) throw new ContentError('dirty-target', '请先保存正在编辑的段落。');
      edit ??= { id: crypto.randomUUID(), target: id, version: 0 };
      edit.version++;
      epoch++;
      update({});
      return { ...edit };
    },
    capture() {
      const value = target();
      if (edit || pending) throw new ContentError('dirty-target', '请先保存讲稿后使用 AI。');
      return { target: structuredClone(value), epoch, projectId };
    },
    assertCapture(captured: { target: SpeechTarget; epoch: number; projectId: string }) {
      const value = target();
      if (
        edit ||
        pending ||
        captured.projectId !== projectId ||
        captured.epoch !== epoch ||
        captured.target.kind !== value.kind ||
        captured.target.id !== value.id ||
        captured.target.revision !== value.revision
      )
        throw new ContentError('stale-proposal', '讲稿或草稿已变化，请重新请求 AI 修改。');
    },
    async commit(commands: ContentCommand[], editId?: string) {
      const value = target();
      return save(applyContentCommands(value.content, commands, state.data!.paper), 'edit', editId);
    },
    async undo() {
      const previous = past[past.length - 1];
      if (previous)
        return save(structuredClone(previous.content), 'undo', undefined, structuredClone(previous.assignments));
    },
    async redo() {
      const next = future[future.length - 1];
      if (next) return save(structuredClone(next.content), 'redo', undefined, structuredClone(next.assignments));
    },
    async discard() {
      await pending;
      edit = undefined;
      epoch++;
      update({ error: undefined });
    },
    async leave() {
      await pending;
      if (edit) throw new ContentError('dirty-target', '讲稿尚未保存，请重试保存或取消输入。');
      epoch++;
    },
    close() {
      closed = true;
      epoch++;
      edit = undefined;
      setDirty(key, false);
      listeners.clear();
    },
  };
}
export type OutlineSession = ReturnType<typeof createOutlineSession>;
