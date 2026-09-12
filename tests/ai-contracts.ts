import { createSlidesAssistant } from '../src/app/assistant/slidesAssistant';
import { DeckSession } from '../src/app/presentation/DeckSession';
import { DEFAULT_SETTINGS } from '../src/app/settings/modelSettings';
import { slidesStore } from '../src/app/composition';
import { get, transaction } from '../src/infrastructure/persistence/indexedDb';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
export async function runAiContracts(projectId: string) {
  const state = await slidesStore.open(projectId);
  if (!state.current) throw new Error('需要主链生成的当前稿');
  const session = new DeckSession(state.current, state.paper, slidesStore.revision(projectId), projectId);
  const before = structuredClone(session.current);
  const slideIds = before.slides.slice(0, 2).map((s) => s.id);
  const controller = new AbortController();
  const result = await createSlidesAssistant(async ({ tools }) => {
    tools[0].execute({
      scope: { type: 'slides', slideIds },
      mutations: slideIds.map((slideId, index) => ({
        type: 'update-slide',
        slideId,
        changes: { title: `同批 AI 修改 ${index + 1}` },
      })),
      summary: '两页标题',
    });
    return '请预览';
  })({
    session,
    paper: state.paper,
    settings: DEFAULT_SETTINGS,
    question: '修改选中页面',
    mode: 'edit',
    slideIds,
    signal: controller.signal,
    onText() {},
  });
  const proposal = result.proposal!;
  assert(JSON.stringify((await slidesStore.open(projectId)).current) === JSON.stringify(before), '候选预览不得持久化');
  assert(!session.canUndo, '预览不得推进 Undo');
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'history') throw new DOMException('fixed AI history failure', 'QuotaExceededError');
    return put.apply(this, args);
  };
  let failed = false;
  try {
    await session.commit(proposal.args.scope, proposal.args.mutations, proposal.args.summary);
  } catch {
    failed = true;
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert(failed, '历史写入失败必须拒绝');
  assert(JSON.stringify(session.current) === JSON.stringify(before) && !session.canUndo, '保存失败不改变会话');
  assert(JSON.stringify((await slidesStore.open(projectId)).current) === JSON.stringify(before), '历史失败回滚 Deck');
  session.assertCapture(proposal.capture);
  await session.commit(proposal.args.scope, proposal.args.mutations, proposal.args.summary);
  const saved = await slidesStore.open(projectId);
  assert(saved.current?.revision === before.revision + 1, '批量应用仅增加一个版本');
  assert(
    saved.current?.slides.slice(0, 2).every((s) => s.title.startsWith('同批 AI')),
    '批次全部持久化',
  );
  let stale = false;
  try {
    session.assertCapture(proposal.capture);
  } catch {
    stale = true;
  }
  assert(stale, '已应用候选不能二次提交');
  await session.undo();
  assert(JSON.stringify(session.current.slides) === JSON.stringify(before.slides), '一个 Undo 撤销完整批次');
  const paper = await transaction(['papers'], 'readonly', (tx) => get(tx, 'papers', state.paper.id));
  assert(JSON.stringify(paper) === JSON.stringify(state.paper), 'AI 编辑不能改变论文底稿');
  return 'PASS: formal AI preview, atomic history failure rollback, one commit/Undo, stale reapply, bound paper unchanged';
}
