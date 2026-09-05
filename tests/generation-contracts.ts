import { fixtureDeck, fixturePaper } from '../src/fixtures';
import { assembleDeck } from '../src/generation';
import { validatePlan } from '../src/layout';
import { createProject, deleteProject, loadProject, saveStage } from '../src/storage';
import type { DeckPlan, Paper } from '../src/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function rejected(work: () => unknown | Promise<unknown>) { let failed = false; try { await work(); } catch { failed = true; } assert(failed, '应拒绝无效阶段'); }
export function fixedPlan(paper: Paper): DeckPlan {
  const figure = paper.figures[0];
  return { schemaVersion: 1, paperId: paper.id, title: fixtureDeck.title, language: fixtureDeck.language,
    slides: fixtureDeck.slides.map(({ elements, ...slide }) => ({ ...slide, sourceIds: [figure.sourceId], claimIds: [], figures: elements.filter(element => element.type === 'figure').map(() => ({ figureId: figure.id })) })),
  };
}
export function fixedSlides(plan: DeckPlan) {
  return { slides: plan.slides.map((slide, index) => {
    let figureIndex = 0;
    return { id: slide.id, elements: fixtureDeck.slides[index].elements.map(element => element.type === 'figure' ? { ...element, ...slide.figures[figureIndex++] } : element.type === 'citation' ? { ...element, sourceIds: slide.sourceIds } : element) };
  }) };
}
export async function runGenerationContracts() {
  const signal = new AbortController().signal;
  let project = await createProject(new File(['%PDF-fixture'], 'generation.pdf'));
  const paper = { ...structuredClone(fixturePaper), id: project.paperId };
  project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
  project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
  project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
  const plan = fixedPlan(paper); const raw = fixedSlides(plan);
  await rejected(() => validatePlan({ ...plan, slides: [] }, paper));
  await rejected(() => validatePlan({ ...plan, paperId: 'other' }, paper));
  const invalid = structuredClone(plan); invalid.slides[1].figures[0].panelId = 'missing';
  await rejected(() => validatePlan(invalid, paper));
  await rejected(() => assembleDeck(plan, { slides: raw.slides.slice(1) }, paper));
  const beforePlan = project;
  project = await saveStage(project, { checkpoint: 'deck-plan-ready', plan }, signal);
  assert((await loadProject(project.id)).plan?.slides.length === 3, '完整计划应可重开');
  await rejected(() => saveStage(beforePlan, { checkpoint: 'deck-plan-ready', plan }, signal));
  const deck = assembleDeck(plan, raw, paper);
  assert(deck.slides[0].elements[0].id !== raw.slides[0].elements[0].id, '元素 ID 由应用创建');
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) { if (this.name === 'decks') throw new DOMException('fixed failure', 'QuotaExceededError'); return originalAdd.apply(this, args); };
  try { await rejected(() => saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general' }, signal)); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  assert((await loadProject(project.id)).project.checkpoint === 'deck-plan-ready', '失败不能删除计划或推进阶段');
  const cancelled = new AbortController();
  IDBObjectStore.prototype.add = function (...args) { const result = originalAdd.apply(this, args); if (this.name === 'decks') cancelled.abort(); return result; };
  try { await rejected(() => saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general' }, cancelled.signal)); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  assert(!(await loadProject(project.id)).deck, '提交期间取消必须回滚整个阶段');
  const ready = await saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general' }, signal);
  const opened = await loadProject(project.id);
  assert(ready.currentDeckId === deck.id && opened.deck?.slides.length === 3 && !opened.plan, '完成后只保留 Current');
  const remainingPlan = await new Promise(resolve => { const r = indexedDB.open('smartjc', 1); r.onsuccess = () => { const db = r.result; const tx = db.transaction('plans'); const q = tx.objectStore('plans').get(project.id); q.onsuccess = () => resolve(q.result); tx.oncomplete = () => db.close(); }; });
  assert(!remainingPlan, '临时计划记录必须物理删除');
  await deleteProject(project.id);
  await rejected(() => saveStage(project, { checkpoint: 'deck-ready', deck, strategyId: 'general' }, signal));
  return 'PASS: plan/source validation/complete assembly/atomic failure/cancel during write/plan cleanup/stale and deleted stage';
}
