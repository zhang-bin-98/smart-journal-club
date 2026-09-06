import { DeckSession, type PersistRevision } from '../src/modules/deck/DeckSession';
import { fixtureDeck, fixturePaper } from './fixtures';
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  saveStage,
  updateProject,
} from '../src/modules/project/projectRepository';
import { saveRevision } from '../src/modules/deck/deckRepository';
import { getPaper, getPaperClaim, getPaperFigure, getPaperPage } from '../src/modules/paper/paperRepository';
import { validatePaper } from '../src/modules/paper/sources';

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function rejected(work: () => unknown | Promise<unknown>, message: string) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, message);
}
async function database(work: (tx: IDBTransaction) => void) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('smartjc', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['projects', 'papers', 'decks', 'settings'], 'readwrite');
      work(tx);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

export async function runContracts() {
  const before = (await listProjects()).length;
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'assets') throw new DOMException('fixed failure', 'QuotaExceededError');
    return originalAdd.apply(this, args);
  };
  try {
    await rejected(() => createProject(new File(['%PDF-fixture'], 'atomic.pdf')), '创建失败必须拒绝');
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  assert((await listProjects()).length === before, '创建失败不得留下半项目');
  const created = await createProject(new File(['%PDF-fixture'], 'fixture.pdf'));
  const signal = new AbortController().signal;
  let project = created;
  const paper = { ...structuredClone(fixturePaper), id: project.paperId, metadata: { title: '论文原标题' } };
  await updateProject(project.id, { name: '用户的名称' });
  project = await saveStage(created, { checkpoint: 'pdf-parsed', paper }, signal);
  assert(project.name === '用户的名称' && project.nameIsCustom, '阶段提交必须保留用户重命名');
  await rejected(() => saveStage(created, { checkpoint: 'pdf-parsed', paper }, signal), '旧阶段不得回退检查点');
  const cancelled = new AbortController();
  cancelled.abort();
  await rejected(
    () => saveStage(project, { checkpoint: 'figures-ready', paper }, cancelled.signal),
    '取消不得推进阶段',
  );
  assert((await loadProject(project.id)).project.checkpoint === 'pdf-parsed', '取消保留稳定阶段');
  project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
  const initial = { ...structuredClone(fixtureDeck), id: crypto.randomUUID(), paperId: paper.id };
  await database((tx) => {
    tx.objectStore('decks').put(initial, initial.id);
    tx.objectStore('projects').put({ ...project, currentDeckId: initial.id, checkpoint: 'deck-ready' }, project.id);
    tx.objectStore('settings').put({ marker: 'independent-setting' }, 'contract-check');
  });
  const persist: PersistRevision = (previous, next, record) => saveRevision(project.id, previous, next, record);
  const session = new DeckSession(initial, paper, persist, project.id);
  const stale = new DeckSession(initial, paper, persist, project.id);
  const edit = (value: string) =>
    session.commit(
      { type: 'slides', slideIds: ['slide-1'] },
      [{ type: 'update-slide', slideId: 'slide-1', changes: { title: value } }],
      '契约检查',
    );
  await edit('已经提交的标题');
  const languageSession = new DeckSession(initial, paper);
  await languageSession.commit(
    { type: 'deck' },
    [{ type: 'set-language', language: 'en-US' }],
    '切换语言',
    crypto.randomUUID(),
  );
  assert(languageSession.current.language === 'en-US', 'set-language 应受控修改');
  assert((await getPaper(project.id)).id === project.paperId, 'Paper 读取必须限定当前项目');
  assert((await getPaperPage(project.id, 1)).pageNumber === 1, 'Paper 页读取应返回指定页');
  assert((await getPaperFigure(project.id, paper.figures[0].id)).id === paper.figures[0].id, 'Figure 读取应返回指定图');
  await rejected(() => getPaperClaim(project.id, 'missing-claim'), '缺失 Claim 不得跨项目读取');
  await rejected(
    () =>
      stale.commit(
        { type: 'slides', slideIds: ['slide-1'] },
        [{ type: 'update-slide', slideId: 'slide-1', changes: { title: '过期响应' } }],
        '旧请求',
      ),
    '旧 Deck 版本不得覆盖',
  );
  assert(stale.current.revision === 0 && !stale.canUndo, '旧请求不得改变会话');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'decks') throw new DOMException('fixed failure', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try {
    await rejected(() => edit('写入失败'), '写入失败必须拒绝');
    await rejected(() => session.undo(), 'Undo 写入失败必须拒绝');
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert(session.current.revision === 1 && session.canUndo && !session.canRedo, '失败不得推进版本或移动撤销栈');
  assert((await loadProject(project.id)).deck!.slides[0].title === '已经提交的标题', '数据库保留稳定内容');
  await session.undo();
  assert(
    session.current.revision === 2 && session.current.slides[0].title === initial.slides[0].title,
    'Undo 恢复内容并递增版本',
  );
  await session.redo();
  assert(session.current.revision === 3, 'Redo 递增版本');
  await session.undo();
  await edit('撤销后新编辑');
  assert(!session.canRedo, '新编辑清空 Redo');
  const stable = JSON.stringify(session.current);
  await rejected(
    () =>
      session.commit(
        { type: 'slides', slideIds: ['slide-1'] },
        [
          { type: 'update-slide', slideId: 'slide-1', changes: { title: '半个批次' } },
          { type: 'delete-slide', slideId: 'missing' },
        ],
        '失败批次',
      ),
    '失败批次必须拒绝',
  );
  assert(JSON.stringify(session.current) === stable, '失败批次不得半提交');
  const figure = session.current.slides[1].elements.find((element) => element.type === 'figure')!;
  assert(figure.type === 'figure', 'fixture 图元素存在');
  await session.commit(
    { type: 'element', slideId: 'slide-2', elementId: figure.id },
    [
      {
        type: 'replace-element',
        slideId: 'slide-2',
        element: { ...figure, cropOverride: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
      },
    ],
    '裁图',
  );
  const restored = await loadProject(project.id);
  assert(
    restored.deck!.slides[2].elements.every((element) => element.type !== 'figure' || !element.cropOverride),
    '裁图不得影响共享引用',
  );
  assert(JSON.stringify(restored.paper.sources) === JSON.stringify(paper.sources), '裁图不得改 Source');
  await rejected(
    () =>
      session.commit(
        { type: 'element', slideId: 'slide-2', elementId: figure.id },
        [
          {
            type: 'replace-element',
            slideId: 'slide-2',
            element: { ...figure, cropOverride: { x: 0.9, y: 0.1, width: 0.5, height: 0.5 } },
          },
        ],
        '越界裁图',
      ),
    'bbox 越界必须拒绝',
  );
  const broken = structuredClone(paper);
  broken.figures[0].panels[0].sourceId = 'missing';
  await rejected(() => validatePaper(broken), '断裂 Panel 来源必须拒绝');
  await deleteProject(project.id);
  await rejected(() => edit('已删除项目旧编辑'), '不得重建已删除项目');
  await rejected(() => saveStage(created, { checkpoint: 'pdf-parsed', paper }, signal), '旧阶段不得重建已删除项目');
  await database((tx) => {
    const req = tx.objectStore('settings').get('contract-check');
    req.onsuccess = () => {
      assert(req.result?.marker === 'independent-setting', '删除项目不得删除设置');
      tx.objectStore('settings').delete('contract-check');
    };
  });
  assert((await listProjects()).length === before, '契约检查清理自己的项目');
  return 'PASS: atomic create/stages/revisions, rename, stale/cancel/delete, undo/redo failures, crop isolation, source validation';
}
