import { narrativePaper, narrativePlan, narrativeDeck } from './narrative-fixture';
import { createProject, deleteProject, loadProject, saveStage } from '../src/modules/project/projectRepository';
import { OutlineSession } from '../src/modules/outline/OutlineSession';
import { savePlanRevision } from '../src/modules/outline/outlineRepository';
import { get, transaction } from '../src/shared/persistence/indexedDb';
import type { PlanRecord } from '../src/modules/outline/planRecord.schema';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejected(work: () => Promise<unknown>) {
  try {
    await work();
  } catch {
    return;
  }
  throw new Error('应拒绝非法事务');
}

export async function runOutlineContracts() {
  const signal = new AbortController().signal;
  let project = await createProject(new File(['%PDF-fixture'], 'outline.pdf'));
  const paper = { ...narrativePaper(), id: project.paperId };
  try {
    project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
    project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
    project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
    const plan = { ...narrativePlan(), paperId: paper.id };
    project = await saveStage(project, { checkpoint: 'deck-plan-ready', plan }, signal);
    const opened = await loadProject(project.id);
    assert(opened.plan?.id === plan.id, '初次计划必须可重新打开');
    const first = new OutlineSession(plan, paper, project.id, savePlanRevision);
    const other = new OutlineSession(plan, paper, project.id, savePlanRevision);
    const patch = [{ type: 'update-section' as const, sectionId: 'n-sec-opening', patch: { title: '已保存章名' } }];
    const originalRequest = first.capture();
    await first.commit({ ...originalRequest, mutations: patch });
    await rejected(() => other.commit({ ...other.capture(), mutations: patch }));
    assert(other.current.revision === plan.revision, '并发失败不改内存');
    await first.undo();
    assert((await loadProject(project.id)).plan?.revision === plan.revision + 2, '撤销仍递增持久化 revision');
    await first.redo();
    await rejected(() =>
      savePlanRevision(
        { ...originalRequest, baseRevision: first.current.revision },
        { ...first.current, revision: first.current.revision + 1 },
      ),
    );
    const before = JSON.stringify(await loadProject(project.id));
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects') throw new DOMException('fixed failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    try {
      await rejected(() => first.commit({ ...first.capture(), mutations: patch }));
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    assert(JSON.stringify(await loadProject(project.id)) === before, '后续写入失败必须回滚计划和项目');
    const abort = new AbortController();
    IDBObjectStore.prototype.put = function (...args) {
      const result = originalPut.apply(this, args);
      if (this.name === 'plans') abort.abort();
      return result;
    };
    try {
      await rejected(() => first.commit({ ...first.capture(), mutations: patch }, { signal: abort.signal }));
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    assert(JSON.stringify(await loadProject(project.id)) === before, '事务中取消必须回滚');
    const forged = {
      ...first.current,
      status: 'confirmed' as const,
      confirmedAt: Date.now(),
      revision: first.current.revision + 1,
    };
    await rejected(() => savePlanRevision(first.capture(), forged));
    await rejected(() => savePlanRevision(first.capture(), { ...forged, slides: [] }, { command: 'confirm' }));
    await first.confirm(first.capture());
    assert((await loadProject(project.id)).plan?.status === 'confirmed', '确认状态可刷新恢复');
    await first.commit({ ...first.capture(), mutations: patch });
    assert((await loadProject(project.id)).plan?.status === 'draft', '编辑确认版必须保存为 draft');
    const deck = { ...narrativeDeck(), paperId: paper.id };
    await transaction(['projects', 'plans', 'decks'], 'readwrite', async (tx) => {
      tx.objectStore('projects').put({ ...project, checkpoint: 'deck-ready', currentDeckId: deck.id }, project.id);
      tx.objectStore('decks').put(deck, deck.id);
      const record = (await get<PlanRecord>(tx, 'plans', project.id))!;
      tx.objectStore('plans').put(
        { ...record, mode: 'regeneration', base: { current: { deckId: deck.id, revision: deck.revision } } },
        project.id,
      );
    });
    await first.commit({ ...first.capture(), mutations: patch });
    await transaction(['decks'], 'readwrite', async (tx) => {
      tx.objectStore('decks').put({ ...deck, revision: deck.revision + 1 }, deck.id);
    });
    await rejected(() => first.commit({ ...first.capture(), mutations: patch }));
    await rejected(() => first.confirm(first.capture()));
    return 'PASS: outline real IndexedDB save/reopen/confirm/edit/undo/redo/concurrency/deduplication/quota rollback/abort rollback/stale candidate';
  } finally {
    await deleteProject(project.id);
  }
}
