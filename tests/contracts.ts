import { DeckSession } from '../src/app/presentation/DeckSession';
import { slidesFixture } from './speech-fixture';
import { createProject, deleteProject, renameProject } from '../src/infrastructure/persistence/projectStore';
import { slidesStore } from '../src/app/composition';
import { get, transaction } from '../src/infrastructure/persistence/indexedDb';
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function rejects(work: () => Promise<unknown>, message: string) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, message);
}
/** 与 M15 单元提交及 M18 候选事务互补，复用同一讲述 fixture 检查正式编辑入口。 */
export async function runContracts() {
  const created = await createProject({ primary: new File(['%PDF-fixture'], 'contract.pdf') });
  const id = created.project.id;
  const { state, deck } = slidesFixture();
  state.paper.id = created.paper.id;
  state.paper.projectId = id;
  deck.paperId = state.paper.id;
  await transaction(['projects', 'papers', 'decks', 'settings'], 'readwrite', async (tx) => {
    tx.objectStore('projects').put({ ...created.project, currentDeckId: deck.id }, id);
    tx.objectStore('papers').put(state.paper, state.paper.id);
    tx.objectStore('decks').put(deck, deck.id);
    tx.objectStore('settings').put({ marker: 'independent' }, 'contract-marker');
  });
  const session = new DeckSession(deck, state.paper, slidesStore.revision(id), id);
  const stale = new DeckSession(deck, state.paper, slidesStore.revision(id), id);
  const edit = (target: DeckSession, title: string) =>
    target.commit(
      { type: 'slides', slideIds: ['slide-0'] },
      [{ type: 'update-slide', slideId: 'slide-0', changes: { title } }],
      title,
    );
  let deleted = false;
  try {
    await renameProject(id, '人工名称');
    await edit(session, '编辑后标题');
    assert((await slidesStore.open(id)).project.name === '人工名称', '编辑不能覆盖重命名');
    await rejects(() => edit(stale, '迟到旧稿'), '旧版本必须拒绝');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'history') throw new DOMException('fixed failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
    const saved = structuredClone(session.current);
    try {
      await rejects(() => session.undo(), 'Undo 历史保存失败拒绝');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert(
      JSON.stringify(session.current) === JSON.stringify(saved) && session.canUndo && !session.canRedo,
      '失败 Undo 保留栈与正文',
    );
    await session.undo();
    await session.redo();
    assert(session.current.slides[0].title === '编辑后标题', '成功 Undo/Redo');
    const first = session.current.slides[0].elements.find((e) => e.type === 'figure')!;
    await session.commit(
      { type: 'element', slideId: 'slide-0', elementId: first.id },
      [
        {
          type: 'replace-element',
          slideId: 'slide-0',
          element: { ...first, cropOverride: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
        },
      ],
      '独立裁图',
    );
    const opened = await slidesStore.open(id);
    assert(
      opened.current!.slides[1].elements.every((e) => e.type !== 'figure' || !e.cropOverride),
      '单页裁图不影响共享图实例',
    );
    assert(JSON.stringify(opened.paper.sources) === JSON.stringify(state.paper.sources), '单页裁图不改底稿');
    await deleteProject(id);
    deleted = true;
    await rejects(() => edit(session, '已删除项目'), '迟到保存不得重建已删除项目');
    assert(
      (await transaction(['settings'], 'readonly', (tx) => get<{ marker: string }>(tx, 'settings', 'contract-marker')))
        ?.marker === 'independent',
      '删除项目不删除设置',
    );
  } finally {
    if (!deleted) await deleteProject(id);
    await transaction(['settings'], 'readwrite', async (tx) => {
      tx.objectStore('settings').delete('contract-marker');
    });
  }
  return 'PASS: current editor rename, stale revision, failed Undo rollback, crop isolation, deleted project, settings isolation';
}
