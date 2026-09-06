import { fixtureDeck, fixturePaper } from './fixtures';
import { DeckSession } from '../src/modules/deck/DeckSession';
import { assembleDeck } from '../src/modules/generation/buildDeck';
import { validatePlan } from '../src/modules/outline/validatePlan';
import { captureVersion, commitRegeneration, restorePrevious, saveRevision } from '../src/modules/deck/deckRepository';
import {
  createProject,
  deleteProject,
  loadProject,
  saveStage,
  type ProjectData,
} from '../src/modules/project/projectRepository';
import type { DeckPlan } from '../src/modules/outline/outline.schema';
import type { Paper } from '../src/modules/paper/paper.schema';
import { narrativePlan } from './narrative-fixture';
import { OutlineSession } from '../src/modules/outline/OutlineSession';
import { savePlanRevision } from '../src/modules/outline/outlineRepository';

export function fixedOutline(paper: Paper): DeckPlan {
  const plan = narrativePlan();
  plan.paperId = paper.id;
  plan.title = paper.metadata.title ?? plan.title;
  plan.slides = plan.slides.map((slide) => ({
    ...slide,
    claimIds: slide.kind === 'result' ? [paper.claims[0].id] : [],
    sourceIds: slide.kind === 'result' ? paper.sources.map((source) => source.id) : [],
    figures: slide.figures.map(() => ({ figureId: paper.figures[0].id })),
  }));
  const secondResult = plan.slides.filter((slide) => slide.kind === 'result')[1];
  secondResult.layoutId = 'figure-full';
  secondResult.figures = [{ figureId: paper.figures[0].id }];
  return plan;
}

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function rejected(work: () => unknown | Promise<unknown>) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, '应拒绝无效阶段');
}
export function fixedPlan(paper: Paper): DeckPlan {
  const figure = paper.figures[0];
  return {
    schemaVersion: 2,
    id: 'fixture-plan',
    paperId: paper.id,
    title: fixtureDeck.title,
    language: fixtureDeck.language,
    status: 'draft',
    revision: 0,
    sections: fixtureDeck.sections.map((section) => ({ ...section, slideBudget: 1 })),
    slides: fixtureDeck.slides.map(({ elements, purpose, message, ...slide }) => ({
      ...slide,
      purpose: purpose ?? '',
      message: message ?? '',
      sourceIds: [figure.sourceId],
      claimIds: [],
      figures: elements.filter((element) => element.type === 'figure').map(() => ({ figureId: figure.id })),
    })),
    claimEmphasis: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
export function fixedSlides(plan: DeckPlan) {
  if (plan.slides.length !== fixtureDeck.slides.length)
    return {
      slides: plan.slides.map((slide) => ({
        id: slide.id,
        elements: slide.figures.length
          ? slide.figures.map((figure, index) => ({ id: `${slide.id}-figure-${index}`, type: 'figure', ...figure }))
          : [{ id: `${slide.id}-text`, type: 'text', text: slide.message || slide.title }],
      })),
    };
  return {
    slides: plan.slides.map((slide, index) => {
      let figureIndex = 0;
      return {
        id: slide.id,
        elements: fixtureDeck.slides[index].elements.map((element) =>
          element.type === 'figure'
            ? { ...element, ...slide.figures[figureIndex++] }
            : element.type === 'citation'
              ? { ...element, sourceIds: slide.sourceIds }
              : element,
        ),
      };
    }),
  };
}
export async function runGenerationContracts() {
  const signal = new AbortController().signal;
  let project = await createProject(new File(['%PDF-fixture'], 'generation.pdf'));
  const paper = { ...structuredClone(fixturePaper), id: project.paperId };
  project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
  project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
  project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
  let plan = fixedOutline(paper);
  const raw = fixedSlides(plan);
  assert(validatePlan({ ...plan, slides: [] }, paper).slides.length === 0, '空页大纲可保存为草稿');
  await rejected(() => validatePlan({ ...plan, paperId: 'other' }, paper));
  const invalid = structuredClone(plan);
  invalid.slides.find((slide) => slide.figures.length)!.figures[0].panelId = 'missing';
  await rejected(() => validatePlan(invalid, paper));
  await rejected(() => assembleDeck(plan, { slides: raw.slides.slice(1) }, paper));
  const beforePlan = project;
  project = await saveStage(project, { checkpoint: 'deck-plan-ready', plan }, signal);
  assert((await loadProject(project.id)).plan?.slides.length === plan.slides.length, '完整计划应可重开');
  await rejected(() => saveStage(beforePlan, { checkpoint: 'deck-plan-ready', plan }, signal));
  const outline = new OutlineSession(plan, paper, project.id, savePlanRevision);
  plan = await outline.confirm(outline.capture());
  const binding = { planId: plan.id, planRevision: plan.revision };
  const deck = assembleDeck(plan, raw, paper);
  assert(deck.slides[0].elements[0].id !== raw.slides[0].elements[0].id, '元素 ID 由应用创建');
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'decks') throw new DOMException('fixed failure', 'QuotaExceededError');
    return originalAdd.apply(this, args);
  };
  try {
    await rejected(() =>
      saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general', ...binding }, signal),
    );
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  assert((await loadProject(project.id)).project.checkpoint === 'deck-plan-ready', '失败不能删除计划或推进阶段');
  const cancelled = new AbortController();
  IDBObjectStore.prototype.add = function (...args) {
    const result = originalAdd.apply(this, args);
    if (this.name === 'decks') cancelled.abort();
    return result;
  };
  try {
    await rejected(() =>
      saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general', ...binding }, cancelled.signal),
    );
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  assert(!(await loadProject(project.id)).deck, '提交期间取消必须回滚整个阶段');
  const ready = await saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general', ...binding }, signal);
  const opened = await loadProject(project.id);
  assert(
    ready.currentDeckId === deck.id && opened.deck?.slides.length === plan.slides.length && !opened.plan,
    '完成后只保留 Current',
  );
  const remainingPlan = await new Promise((resolve) => {
    const r = indexedDB.open('smartjc', 1);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('plans');
      const q = tx.objectStore('plans').get(project.id);
      q.onsuccess = () => resolve(q.result);
      tx.oncomplete = () => db.close();
    };
  });
  assert(!remainingPlan, '临时计划记录必须物理删除');
  await checkVersions(opened);
  await deleteProject(project.id);
  await rejected(() =>
    saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general', ...binding }, signal),
  );
  return 'PASS: plan/source validation/complete assembly/atomic failure/cancel during write/plan cleanup/stale and deleted stage/regeneration atomicity/previous swap and cleanup';
}
async function storedDeckIds(projectId: string) {
  return new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('smartjc', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['projects', 'decks']);
      const project = tx.objectStore('projects').get(projectId);
      project.onsuccess = () => {
        const all = tx.objectStore('decks').getAll();
        all.onsuccess = () =>
          resolve(
            all.result
              .filter((deck) => deck.paperId === project.result.paperId)
              .map((deck) => deck.id)
              .sort(),
          );
      };
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}
async function checkVersions(initial: ProjectData) {
  const { paper } = initial;
  const original = initial.deck!;
  const signal = new AbortController().signal;
  const captured = captureVersion(initial.project, original);
  const nextPlanSession = new OutlineSession(fixedOutline(paper), paper, initial.project.id);
  const confirmed = await nextPlanSession.confirm(nextPlanSession.capture());
  const nextDeck = () => assembleDeck(confirmed, fixedSlides(confirmed), paper);
  const preferences = {
    ...initial.project.preferences,
    instruction: '重新生成时采用新的汇报重点',
    strategyId: 'general',
  };
  const failed = nextDeck();
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'decks') throw new DOMException('fixed version failure', 'QuotaExceededError');
    return originalAdd.apply(this, args);
  };
  try {
    await rejected(() => commitRegeneration(captured, failed, preferences, signal));
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  const cancelled = new AbortController();
  IDBObjectStore.prototype.add = function (...args) {
    const result = originalAdd.apply(this, args);
    if (this.name === 'decks') cancelled.abort();
    return result;
  };
  try {
    await rejected(() => commitRegeneration(captured, failed, preferences, cancelled.signal));
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  await rejected(() => commitRegeneration(captured, failed, preferences, signal, () => false));
  let opened = await loadProject(initial.project.id);
  assert(
    opened.project.currentDeckId === original.id &&
      !opened.project.previousDeckId &&
      JSON.stringify(opened.project.preferences) === JSON.stringify(initial.project.preferences),
    '失败或取消不得切换版本或写入新偏好',
  );
  assert((await storedDeckIds(initial.project.id)).join() === original.id, '失败或取消不得留下新 Deck');

  const second = nextDeck();
  const regenerated = await commitRegeneration(captured, second, preferences, signal);
  assert(
    regenerated.project.currentDeckId === second.id &&
      regenerated.project.previousDeckId === original.id &&
      regenerated.deck.revision === 0,
    '成功重生成才将旧 Current 留作 Previous',
  );
  opened = await loadProject(initial.project.id);
  assert(
    opened.project.preferences.instruction === preferences.instruction &&
      opened.project.preferences.strategyId === preferences.strategyId,
    '偏好随成功新版本保存并可重开',
  );
  assert(JSON.stringify(opened.paper) === JSON.stringify(paper), '整套重生成不得重写 Paper');
  const firstRestore = await restorePrevious(captureVersion(opened.project, opened.deck!), signal);
  assert(
    firstRestore.deck.id === original.id &&
      firstRestore.deck.revision === original.revision + 1 &&
      firstRestore.project.previousDeckId === second.id,
    '恢复应交换两版并递增成为 Current 的版本号',
  );
  const secondRestore = await restorePrevious(captureVersion(firstRestore.project, firstRestore.deck), signal);
  assert(
    secondRestore.deck.id === second.id &&
      secondRestore.deck.revision === 1 &&
      secondRestore.project.previousDeckId === original.id,
    '再次恢复可以切回且继续递增对应版本号',
  );

  const third = nextDeck();
  const replaced = await commitRegeneration(
    captureVersion(secondRestore.project, secondRestore.deck),
    third,
    preferences,
    signal,
  );
  assert(
    (await storedDeckIds(initial.project.id)).join() === [second.id, third.id].sort().join(),
    '新版本成功后仅保留 Current 和最近 Previous，删除更旧 Deck',
  );
  await rejected(() => commitRegeneration(captured, nextDeck(), preferences, signal));
  await rejected(() => restorePrevious(captured, signal));
  const beforeEdit = captureVersion(replaced.project, replaced.deck);
  const session = new DeckSession(
    replaced.deck,
    paper,
    (previous, next, record, options) =>
      saveRevision(initial.project.id, previous, next, record, options?.signal, options),
    initial.project.id,
  );
  await session.commit(
    { type: 'slides', slideIds: [third.slides[0].id] },
    [{ type: 'update-slide', slideId: third.slides[0].id, changes: { title: '重生成后新的手工内容' } }],
    '新版本手工修改',
  );
  await rejected(() => commitRegeneration(beforeEdit, nextDeck(), preferences, signal));
  await rejected(() => restorePrevious(beforeEdit, signal));
  opened = await loadProject(initial.project.id);
  assert(
    opened.deck?.revision === 1 &&
      opened.deck.slides[0].title === '重生成后新的手工内容' &&
      opened.project.previousDeckId === second.id,
    '旧 Current 或 revision 的结果不得覆盖新编辑和 Previous',
  );
  const compatible = opened.deck!;
  // v3 及以上为未来版本按不兼容拒绝；v1 标记的 v2 形状不是合法 legacy 记录，按无法安全升级可恢复拒绝；均零写入。
  for (const version of [1, 3]) {
    await deckRecord(compatible.id, { ...compatible, schemaVersion: version });
    try {
      const error = await loadProject(initial.project.id).then(
        () => '',
        (cause) => String(cause.message),
      );
      assert(error.includes(version === 3 ? '不兼容' : '无法安全升级'), `Schema 版本 ${version} 应可恢复拒绝`);
      await rejected(() =>
        session.commit(
          { type: 'slides', slideIds: [third.slides[0].id] },
          [{ type: 'update-slide', slideId: third.slides[0].id, changes: { title: '不能覆盖新版数据' } }],
          '未知 Schema 拒绝修改',
        ),
      );
      assert((await deckRecord(compatible.id)).schemaVersion === version, '拒绝读取和修改不得重置未知版本数据');
    } finally {
      await deckRecord(compatible.id, compatible);
    }
  }
}
async function deckRecord(id: string, next?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('smartjc', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('decks', next ? 'readwrite' : 'readonly');
      if (next) tx.objectStore('decks').put(next, id);
      const read = tx.objectStore('decks').get(id);
      tx.oncomplete = () => {
        db.close();
        resolve(read.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
}
