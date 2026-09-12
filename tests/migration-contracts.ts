import { fixturePaper } from './fixtures';
import { legacyDeckPlanV1, legacyDeckV1, legacyProject } from './legacy-fixtures';
import { slidesStore } from '../src/app/composition';
const loadProject = slidesStore.open;
import type { Project } from '../src/modules/project/project.schema';
import type { Paper } from '../src/modules/paper/paper.schema';

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function withStores(mode: IDBTransactionMode, work: (tx: IDBTransaction) => void) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('smartjc', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['projects', 'papers', 'assets', 'decks', 'plans'], mode);
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
    open.onerror = () => reject(open.error);
  });
}
type Seeded = { project: Project; paper: Paper; decks: Record<string, unknown>[]; plan?: Record<string, unknown> };
const seeded = new Map<string, Seeded>();
async function deleteProject(id: string) {
  const data = seeded.get(id)!;
  await withStores('readwrite', (tx) => {
    tx.objectStore('projects').delete(id);
    tx.objectStore('papers').delete(data.paper.id);
    tx.objectStore('assets').delete(data.project.pdfAssetId);
    tx.objectStore('plans').delete(id);
    for (const deck of data.decks) tx.objectStore('decks').delete(deck.id as string);
  });
  seeded.delete(id);
}
async function seed({ project, paper, decks, plan }: Seeded) {
  seeded.set(project.id, { project, paper, decks, plan });
  await withStores('readwrite', (tx) => {
    tx.objectStore('projects').put(project, project.id);
    tx.objectStore('papers').put(paper, paper.id);
    tx.objectStore('assets').put(
      { blob: new File(['%PDF-legacy'], 'legacy.pdf'), name: 'legacy.pdf' },
      project.pdfAssetId,
    );
    for (const deck of decks) tx.objectStore('decks').put(deck, deck.id as string);
    if (plan) tx.objectStore('plans').put(plan, project.id);
  });
}
async function readRecord<T>(store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('smartjc', 1);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction(store).objectStore(store).get(key);
      read.onsuccess = () => {
        db.close();
        resolve(read.result);
      };
      read.onerror = () => {
        db.close();
        reject(read.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}
async function captureError(work: () => Promise<unknown>) {
  try {
    await work();
    return '';
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
type StoredDeck = { schemaVersion?: number; revision?: number };
const readDeck = (key: string) => readRecord<StoredDeck>('decks', key);

export async function runMigrationContracts() {
  // 1. 仅 Current v1：打开即迁移、持久化且重复打开零写入。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-migration-current' };
    const deck = { ...structuredClone(legacyDeckV1('legacy-deck-current')), paperId: paper.id };
    const project = legacyProject({
      id: 'migration-current-only',
      paperId: paper.id,
      pdfAssetId: 'asset-migration-current',
      checkpoint: 'deck-ready',
      currentDeckId: deck.id,
    });
    await seed({ project, paper, decks: [deck] });
    try {
      const opened = await loadProject('migration-current-only');
      assert(opened.current?.schemaVersion === 2, 'v1 Current 应在打开时迁移为 v2');
      assert(
        opened.current?.sections.map((section) => section.kind).join() === 'opening,results,synthesis',
        '章节按连续 kind 段生成',
      );
      assert(opened.current?.revision === 3 && opened.current?.slides.length === 4, '迁移不改变 revision 与页面数量');
      const persisted = await readRecord<Record<string, unknown>>('decks', deck.id);
      assert(persisted?.schemaVersion === 1, '浏览只作兼容投影，不改写旧稿');
      const snapshot = JSON.stringify(persisted);
      await loadProject('migration-current-only');
      assert(JSON.stringify(await readRecord('decks', deck.id)) === snapshot, '重复打开不得产生写入');
    } finally {
      await deleteProject('migration-current-only');
    }
  }
  // 2. Current 与 Previous 均为 v1：同批迁移，指针与 revision 不变。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-migration-both' };
    const current = { ...structuredClone(legacyDeckV1('legacy-deck-a')), paperId: paper.id };
    const previous = { ...structuredClone(legacyDeckV1('legacy-deck-b')), paperId: paper.id };
    const project = legacyProject({
      id: 'migration-both',
      paperId: paper.id,
      pdfAssetId: 'asset-migration-both',
      checkpoint: 'deck-ready',
      currentDeckId: current.id,
      previousDeckId: previous.id,
    });
    await seed({ project, paper, decks: [current, previous] });
    try {
      const opened = await loadProject('migration-both');
      assert(opened.current?.id === current.id && opened.project.previousDeckId === previous.id, '版本指针语义不变');
      assert((await readDeck(current.id))?.schemaVersion === 1, 'Current 原稿保留');
      assert((await readDeck(previous.id))?.schemaVersion === 1, 'Previous 原稿保留');
      assert((await readDeck(previous.id))?.revision === 3, '迁移不递增 revision');
    } finally {
      await deleteProject('migration-both');
    }
  }
  // 3. Current 已是 v2、Previous 为 v1：只迁 Previous，Current 记录逐字节不变。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-migration-mixed' };
    const { fixtureDeck } = await import('./fixtures');
    const v2Deck = { ...structuredClone(fixtureDeck), id: 'mixed-v2-current', paperId: paper.id };
    const previous = { ...structuredClone(legacyDeckV1('legacy-deck-mixed')), paperId: paper.id };
    const project = legacyProject({
      id: 'migration-mixed',
      paperId: paper.id,
      pdfAssetId: 'asset-migration-mixed',
      checkpoint: 'deck-ready',
      currentDeckId: v2Deck.id,
      previousDeckId: previous.id,
    });
    await seed({ project, paper, decks: [v2Deck, previous] });
    try {
      const before = JSON.stringify(v2Deck);
      const opened = await loadProject('migration-mixed');
      assert(opened.current?.id === v2Deck.id, 'v2 Current 原样读取');
      assert((await readDeck(previous.id))?.schemaVersion === 1, 'Previous 原稿保留');
      assert(JSON.stringify(await readRecord('decks', v2Deck.id)) === before, 'v2 Current 记录不得被重写');
    } finally {
      await deleteProject('migration-mixed');
    }
  }
  // 4. Previous 损坏：整体拒绝、零写入；修复后可恢复打开。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-migration-failure' };
    const current = { ...structuredClone(legacyDeckV1('legacy-deck-fail-current')), paperId: paper.id };
    const broken = structuredClone(legacyDeckV1('legacy-deck-broken'));
    broken.paperId = paper.id;
    (broken.slides[0] as { kind: string }).kind = 'hypothesis';
    const project = legacyProject({
      id: 'migration-failure',
      paperId: paper.id,
      pdfAssetId: 'asset-migration-failure',
      checkpoint: 'deck-ready',
      currentDeckId: current.id,
      previousDeckId: broken.id,
    });
    await seed({ project, paper, decks: [current, broken] });
    try {
      const error = await captureError(() => loadProject('migration-failure'));
      assert(error.includes('无法安全升级'), '损坏 Previous 应可恢复拒绝');
      assert((await readDeck(current.id))?.schemaVersion === 1, '失败时 Current 不得被提前写回');
      assert((await readDeck(broken.id))?.schemaVersion === 1, '原数据保持 v1 不变');
      const repaired = structuredClone(legacyDeckV1('legacy-deck-broken'));
      repaired.paperId = paper.id;
      await withStores('readwrite', (tx) => {
        tx.objectStore('decks').put(repaired, repaired.id);
      });
      const opened = await loadProject('migration-failure');
      assert(opened.current?.schemaVersion === 2 && opened.project.previousDeckId === repaired.id, '修复后可恢复打开');
    } finally {
      await deleteProject('migration-failure');
    }
  }
  // 5. 未来版本 Current：拒绝读取且 Current/Previous 均零写入。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-migration-future' };
    const future = { ...structuredClone(legacyDeckV1('legacy-deck-future')), paperId: paper.id, schemaVersion: 99 };
    const previous = { ...structuredClone(legacyDeckV1('legacy-deck-future-prev')), paperId: paper.id };
    const project = legacyProject({
      id: 'migration-future',
      paperId: paper.id,
      pdfAssetId: 'asset-migration-future',
      checkpoint: 'deck-ready',
      currentDeckId: future.id,
      previousDeckId: previous.id,
    });
    await seed({ project, paper, decks: [future, previous] });
    try {
      const error = await captureError(() => loadProject('migration-future'));
      assert(error.includes('不兼容'), '未来版本应提示不兼容');
      assert((await readDeck(future.id))?.schemaVersion === 99, '未来版本数据不得被改写');
      assert((await readDeck(previous.id))?.schemaVersion === 1, '同批其他对象零写入');
    } finally {
      await deleteProject('migration-future');
    }
  }
  // 旧临时计划不会被当作新讲稿消费或删除；可读性与缺陷都原样保留。
  for (const broken of [false, true]) {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-preserved-plan' };
    const plan = structuredClone(legacyDeckPlanV1());
    plan.paperId = paper.id;
    if (broken) plan.slides[1].figures[0].figureId = 'missing';
    const project = legacyProject({
      id: 'preserved-plan',
      paperId: paper.id,
      pdfAssetId: 'preserved-asset',
      checkpoint: 'deck-plan-ready',
    });
    await seed({ project, paper, decks: [], plan });
    try {
      const opened = await loadProject(project.id);
      assert(opened.project.lastOpenedStep === 'outline-speech' && !opened.record, '旧计划不是可执行的新计划');
      assert(JSON.stringify(await readRecord('plans', project.id)) === JSON.stringify(plan), '旧计划原样保留');
      const snapshot = JSON.stringify(opened);
      assert(JSON.stringify(await loadProject(project.id)) === snapshot, '重复浏览稳定');
    } finally {
      await deleteProject(project.id);
    }
  }
  // Previous 指针存在但数据缺失时，拒绝迁移并保留 Current 原始记录。
  {
    const paper = { ...structuredClone(fixturePaper), id: 'paper-missing-previous' };
    const current = { ...structuredClone(legacyDeckV1('missing-previous-current')), paperId: paper.id };
    const project = legacyProject({
      id: 'migration-missing-previous',
      paperId: paper.id,
      pdfAssetId: 'asset-missing-previous',
      checkpoint: 'deck-ready',
      currentDeckId: current.id,
      previousDeckId: 'missing-previous',
    });
    await seed({ project, paper, decks: [current] });
    try {
      assert((await captureError(() => loadProject(project.id))).includes('稿件缺失'), '不能忽略失效 Previous 指针');
      assert(
        JSON.stringify(await readRecord('projects', project.id)) === JSON.stringify(project),
        '缺失失败不修改项目',
      );
      assert((await readDeck(current.id))?.schemaVersion === 1, '缺失失败不提前迁移 Current');
    } finally {
      await deleteProject(project.id);
    }
  }
  return 'PASS: formal workspace legacy Current/Previous projection, invalid/future zero write, preserved old plans, idempotent browse, missing previous zero write';
}
