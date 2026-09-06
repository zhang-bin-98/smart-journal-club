import { DeckSchema, ProjectSchema, PaperSchema, RevisionRecordSchema, type ChatMessage, type Deck, type DeckPlan, type Paper, type PdfAsset, type Project } from './types';
import { validateDeck, validatePlan } from './layout';
import { validatePaper } from './sources';
import type { RevisionRecord, RevisionRequest } from './deck';
import { DEFAULT_SETTINGS, ModelSettingsSchema, type ModelSettings } from './model';
import { prompts } from './prompts';

const DATABASE = 'smartjc';
const stores = ['projects', 'papers', 'assets', 'plans', 'decks', 'history', 'settings'] as const;
type Store = typeof stores[number];
const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error ?? new Error('本地存储读取失败'));
});
async function open() {
  const operation = indexedDB.open(DATABASE, 1);
  operation.onupgradeneeded = () => { for (const name of stores) operation.result.createObjectStore(name); };
  const db = await request(operation);
  db.onversionchange = () => db.close();
  return db;
}
async function transaction<T>(names: Store[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const db = await open();
  const tx = db.transaction(names, mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存已取消，最近保存的成果仍保留'));
    tx.onerror = () => reject(tx.error ?? new Error('本地存储写入失败'));
  });
  void complete.catch(() => {});
  const abort = () => { try { tx.abort(); } catch { /* 已完成的事务保持提交结果。 */ } };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await work(tx);
    await complete;
    return result;
  } catch (cause) {
    abort(); await complete.catch(() => {});
    if (cause instanceof DOMException && cause.name === 'QuotaExceededError') throw new Error('本地空间不足，成果未保存。请释放项目空间后重试，并保留当前页面。');
    throw cause;
  } finally { signal?.removeEventListener('abort', abort); db.close(); }
}
const get = <T>(tx: IDBTransaction, name: Store, key: string) => request(tx.objectStore(name).get(key)) as Promise<T | undefined>;
async function projectIn(tx: IDBTransaction, id: string) {
  const value = await get<Project>(tx, 'projects', id);
  if (!value) throw new Error('项目已被删除，请返回首页');
  return ProjectSchema.parse(value);
}
export async function createProject(file: File): Promise<Project> {
  const now = Date.now();
  const project: Project = { schemaVersion: 1, id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, '') || file.name, paperId: crypto.randomUUID(), pdfAssetId: crypto.randomUUID(), checkpoint: 'project-created', preferences: { instruction: '' }, createdAt: now, updatedAt: now };
  const paper: Paper = { schemaVersion: 1, id: project.paperId, metadata: {}, pages: [], sources: [], figures: [], claims: [], evidences: [] };
  await transaction(['projects', 'papers', 'assets'], 'readwrite', async tx => {
    tx.objectStore('projects').add(project, project.id);
    tx.objectStore('papers').add(paper, paper.id);
    tx.objectStore('assets').add({ blob: file, name: file.name } satisfies PdfAsset, project.pdfAssetId);
  });
  return project;
}
export function listProjects() {
  return transaction(['projects', 'decks'], 'readonly', async tx => {
    const items = (await request(tx.objectStore('projects').getAll())).map(value => ProjectSchema.parse(value)).sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(items.map(async project => ({ project, slideCount: project.currentDeckId ? (await get<Deck>(tx, 'decks', project.currentDeckId))?.slides.length : undefined })));
  });
}
export type ProjectData = { project: Project; paper: Paper; asset?: PdfAsset; deck?: Deck; plan?: DeckPlan };
export function loadProject(id: string): Promise<ProjectData> {
  return transaction(['projects', 'papers', 'assets', 'decks', 'plans'], 'readonly', async tx => {
    const project = await projectIn(tx, id);
    const paper = validatePaper(await get(tx, 'papers', project.paperId), ['paper-ready', 'deck-plan-ready', 'deck-ready'].includes(project.checkpoint));
    const asset = await get<PdfAsset>(tx, 'assets', project.pdfAssetId);
    const deck = project.currentDeckId ? DeckSchema.parse(await get(tx, 'decks', project.currentDeckId)) : undefined;
    if (paper.id !== project.paperId) throw new Error('论文关联不一致');
    if (project.checkpoint !== 'project-created' && !paper.pages.length) throw new Error('已保存阶段缺少解析结果，请保留项目并检查本地存储');
    if (project.checkpoint === 'deck-ready' && !deck) throw new Error('已保存的幻灯片缺失');
    if (deck) { const errors = validateDeck(deck, paper); if (errors.length) throw new Error(errors.join('；')); }
    const plan = project.checkpoint === 'deck-plan-ready' ? validatePlan(await get(tx, 'plans', id), paper) : undefined;
    return { project, paper, asset: asset?.blob instanceof Blob ? asset : undefined, deck, plan };
  });
}
export function updateProject(id: string, changes: Partial<Pick<Project, 'name' | 'preferences' | 'lastOpenedSlideId'>>) {
  return transaction(['projects', 'decks'], 'readwrite', async tx => {
    const project = await projectIn(tx, id);
    if ('lastOpenedSlideId' in changes && changes.lastOpenedSlideId) {
      const deck = project.currentDeckId && await get<Deck>(tx, 'decks', project.currentDeckId);
      if (!deck || !deck.slides.some(slide => slide.id === changes.lastOpenedSlideId)) throw new Error('当前页已变化，请重新打开项目');
    }
    const next = ProjectSchema.parse({ ...project, ...changes, nameIsCustom: 'name' in changes ? true : project.nameIsCustom, updatedAt: Date.now() });
    tx.objectStore('projects').put(next, id); return next;
  });
}
export function deleteProject(id: string) {
  return transaction([...stores.filter(store => store !== 'settings')], 'readwrite', async tx => {
    const project = await projectIn(tx, id);
    tx.objectStore('projects').delete(id); tx.objectStore('papers').delete(project.paperId); tx.objectStore('assets').delete(project.pdfAssetId); tx.objectStore('plans').delete(id);
    if (project.currentDeckId) tx.objectStore('decks').delete(project.currentDeckId);
    if (project.previousDeckId) tx.objectStore('decks').delete(project.previousDeckId);
    const history = await request(tx.objectStore('history').getAll()) as RevisionRecord[];
    history.filter(item => item.projectId === id).forEach(item => tx.objectStore('history').delete(item.id));
  });
}

export type StageCapture = Pick<Project, 'id' | 'paperId' | 'pdfAssetId' | 'checkpoint'>;
type StageOutput = { checkpoint: 'pdf-parsed' | 'figures-ready'; paper: Paper } | { checkpoint: 'paper-ready'; paper: Paper; strategyId: string }
  | { checkpoint: 'deck-plan-ready'; plan: DeckPlan } | { checkpoint: 'deck-ready'; deck: Deck; strategyId: string };
export function saveStage(captured: StageCapture, output: StageOutput, signal: AbortSignal) {
  const prior = { 'pdf-parsed': 'project-created', 'figures-ready': 'pdf-parsed', 'paper-ready': 'figures-ready', 'deck-plan-ready': 'paper-ready', 'deck-ready': 'deck-plan-ready' }[output.checkpoint];
  if ('strategyId' in output && !prompts.strategies.some(strategy => strategy.id === output.strategyId)) throw new Error('研究叙事策略不存在');
  if (captured.checkpoint !== prior) throw new Error('阶段产物或顺序不正确');
  return transaction(['projects', 'papers', 'assets', 'plans', 'decks'], 'readwrite', async tx => {
    const project = await projectIn(tx, captured.id);
    if (project.checkpoint !== captured.checkpoint || project.paperId !== captured.paperId || project.pdfAssetId !== captured.pdfAssetId) throw new Error('项目阶段已在其他页面变化，请重新打开');
    if (!((await get<PdfAsset>(tx, 'assets', project.pdfAssetId))?.blob instanceof Blob)) throw new Error('原 PDF 缺失，无法保存本阶段');
    const paper = validatePaper('paper' in output ? output.paper : await get(tx, 'papers', project.paperId), ['paper-ready', 'deck-plan-ready', 'deck-ready'].includes(output.checkpoint));
    if (paper.id !== captured.paperId || !paper.pages.length) throw new Error('阶段产物或论文关联不正确');
    if (output.checkpoint === 'deck-plan-ready') validatePlan(output.plan, paper);
    if (output.checkpoint === 'deck-ready') {
      const plan = validatePlan(await get(tx, 'plans', project.id), paper);
      const errors = validateDeck(output.deck, paper);
      if (errors.length || !output.deck.slides.length || output.deck.revision !== 0 || output.deck.slides.length !== plan.slides.length || output.deck.slides.some((slide, i) => slide.id !== plan.slides[i].id)) throw new Error('完整幻灯片或计划关联无效：' + errors.join('；'));
    }
    signal.throwIfAborted();
    const next: Project = { ...project, name: !project.nameIsCustom && paper.metadata.title ? paper.metadata.title : project.name, checkpoint: output.checkpoint, updatedAt: Date.now() };
    if (output.checkpoint === 'paper-ready') next.preferences = { ...project.preferences, strategyId: output.strategyId };
    if ('paper' in output) tx.objectStore('papers').put(paper, paper.id);
    if (output.checkpoint === 'deck-plan-ready') tx.objectStore('plans').put(output.plan, project.id);
    if (output.checkpoint === 'deck-ready') {
      tx.objectStore('decks').add(output.deck, output.deck.id); tx.objectStore('plans').delete(project.id);
      next.currentDeckId = output.deck.id; next.lastOpenedSlideId = output.deck.slides[0].id;
      next.preferences = { ...project.preferences, strategyId: output.strategyId };
    }
    tx.objectStore('projects').put(next, next.id);
    return next;
  }, signal);
}
export function saveRevision(projectId: string, previous: Deck, next: Deck, record: RevisionRecord, signal?: AbortSignal, guard?: { isTaskActive?: () => boolean; messages?: ChatMessage[] }) {
  return transaction(['projects', 'papers', 'decks', 'history'], 'readwrite', async tx => {
    const project = await projectIn(tx, projectId);
    const current = project.currentDeckId && await get<Deck>(tx, 'decks', project.currentDeckId);
    if (!current || current.id !== previous.id || current.revision !== previous.revision || next.id !== current.id || next.revision !== current.revision + 1) throw new Error('项目已在其他页面修改，当前修改未保存。请重新打开最新项目。');
    if (record.projectId && record.projectId !== projectId) throw new Error('修改请求项目不匹配');
    if (record.deckId !== next.id || record.baseRevision !== previous.revision || record.committedRevision !== next.revision || !record.id) throw new Error('修改请求绑定的版本无效');
    if (await get(tx, 'history', record.id)) throw new Error('本次修改已经提交');
    const paper = validatePaper(await get(tx, 'papers', project.paperId));
    const errors = validateDeck(next, paper); if (errors.length) throw new Error(errors.join('；'));
    signal?.throwIfAborted();
    if (guard?.isTaskActive && !guard.isTaskActive()) throw new Error('修改请求已失效');
    tx.objectStore('decks').put(next, next.id);
    tx.objectStore('projects').put({ ...project, updatedAt: next.updatedAt, lastOpenedSlideId: next.slides.some(slide => slide.id === project.lastOpenedSlideId) ? project.lastOpenedSlideId : next.slides[0]?.id }, projectId);
    tx.objectStore('history').add(RevisionRecordSchema.parse({ ...record, projectId }), record.id);
    for (const message of guard?.messages ?? []) {
      assertMessage(message, projectId, previous);
      if (message.revision !== undefined && message.revision !== next.revision) throw new Error('对话修改版本不匹配');
      tx.objectStore('history').add(message, message.id);
    }
    await trimHistory(tx, projectId);
    signal?.throwIfAborted();
    if (guard?.isTaskActive && !guard.isTaskActive()) throw new Error('修改请求已失效');
  }, signal);
}

type HistoryEntry = RevisionRecord | ChatMessage;
function isMessage(item: HistoryEntry): item is ChatMessage { return 'role' in item; }
function assertMessage(message: ChatMessage, projectId: string, deck: Deck) {
  if (!message.id || message.projectId !== projectId || message.deckId !== deck.id || message.baseRevision !== deck.revision || !['user', 'assistant'].includes(message.role) || !message.text.trim() || !Number.isFinite(message.createdAt)) throw new Error('对话目标或内容无效');
}
async function trimHistory(tx: IDBTransaction, projectId: string) {
  const history = (await request(tx.objectStore('history').getAll()) as HistoryEntry[]).filter(item => item.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  // 请求标识单独保留，避免普通对话挤掉最近的修改去重记录。
  for (const items of [history.filter(isMessage), history.filter(item => !isMessage(item))]) items.slice(100).forEach(item => tx.objectStore('history').delete(item.id));
}
export function loadHistory(projectId: string): Promise<ChatMessage[]> {
  return transaction(['projects', 'history'], 'readonly', async tx => {
    await projectIn(tx, projectId);
    return (await request(tx.objectStore('history').getAll()) as HistoryEntry[]).filter(isMessage).filter(item => item.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt).slice(-100);
  });
}
export function saveConversation(projectId: string, messages: ChatMessage[], signal?: AbortSignal, isTaskActive?: () => boolean) {
  return transaction(['projects', 'decks', 'history'], 'readwrite', async tx => {
    const project = await projectIn(tx, projectId);
    const deck = project.currentDeckId && await get<Deck>(tx, 'decks', project.currentDeckId);
    if (!deck) throw new Error('当前文稿已变化，请重新打开项目');
    for (const message of messages) {
      assertMessage(message, projectId, deck);
      if (message.revision !== undefined) throw new Error('修改摘要必须随修改一起保存');
    }
    signal?.throwIfAborted();
    if (isTaskActive && !isTaskActive()) throw new Error('对话请求已失效');
    for (const message of messages) tx.objectStore('history').add(message, message.id);
    await trimHistory(tx, projectId);
    signal?.throwIfAborted();
    if (isTaskActive && !isTaskActive()) throw new Error('对话请求已失效');
  }, signal);
}
export type RevisionReadContext = RevisionRequest;
export function captureRevision(projectId: string, deck: Deck): RevisionReadContext {
  return { requestId: crypto.randomUUID(), projectId, deckId: deck.id, baseRevision: deck.revision };
}
async function readProjectScoped<T>(projectId: string, reader: (tx: IDBTransaction, project: Project, paper: Paper) => Promise<T>) {
  return transaction(['projects', 'papers', 'decks'], 'readonly', async tx => {
    const project = await projectIn(tx, projectId);
    const paper = PaperSchema.parse(await get(tx, 'papers', project.paperId));
    return reader(tx, project, paper);
  });
}
/** AI 只读工具：返回当前项目的论文概要，不暴露其他项目数据。 */
export function getPaper(projectId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => structuredClone(paper));
}
export function getPaperPage(projectId: string, pageNumber: number) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('页码无效');
    const page = paper.pages.find(item => item.pageNumber === pageNumber);
    if (!page) throw new Error('找不到指定页');
    return structuredClone(page);
  });
}
export function getPaperFigure(projectId: string, figureId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    const figure = paper.figures.find(item => item.id === figureId);
    if (!figure) throw new Error('找不到指定 Figure');
    return structuredClone(figure);
  });
}
export function getPaperClaim(projectId: string, claimId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    const claim = paper.claims.find(item => item.id === claimId);
    if (!claim) throw new Error('找不到指定 Claim');
    return structuredClone(claim);
  });
}
export function getDeck(projectId: string) {
  return readProjectScoped(projectId, async (tx, project, paper) => {
    if (!project.currentDeckId) throw new Error('项目尚未生成幻灯片');
    const deck = DeckSchema.parse(await get(tx, 'decks', project.currentDeckId));
    const errors = validateDeck(deck, paper); if (errors.length) throw new Error(errors.join('；'));
    return structuredClone(deck);
  });
}

export function loadSettings() {
  return transaction(['settings'], 'readonly', async tx => ModelSettingsSchema.parse(await get(tx, 'settings', 'model') ?? DEFAULT_SETTINGS));
}
export function saveSettings(settings: ModelSettings) {
  const next = ModelSettingsSchema.parse({ ...settings, apiKey: settings.apiKey.trim() });
  return transaction(['settings'], 'readwrite', async tx => { tx.objectStore('settings').put(next, 'model'); return next; });
}
