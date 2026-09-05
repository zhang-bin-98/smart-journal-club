import { DeckSchema, ProjectSchema, type Deck, type Paper, type PdfAsset, type Project } from './types';
import { validateDeck } from './layout';
import { validatePaper } from './sources';
import type { RevisionRecord } from './deck';

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
export type ProjectData = { project: Project; paper: Paper; asset?: PdfAsset; deck?: Deck };
export function loadProject(id: string): Promise<ProjectData> {
  return transaction(['projects', 'papers', 'assets', 'decks'], 'readonly', async tx => {
    const project = await projectIn(tx, id);
    const paper = validatePaper(await get(tx, 'papers', project.paperId));
    const asset = await get<PdfAsset>(tx, 'assets', project.pdfAssetId);
    const deck = project.currentDeckId ? DeckSchema.parse(await get(tx, 'decks', project.currentDeckId)) : undefined;
    if (paper.id !== project.paperId) throw new Error('论文关联不一致');
    if (project.checkpoint !== 'project-created' && !paper.pages.length) throw new Error('已保存阶段缺少解析结果，请保留项目并检查本地存储');
    if (project.checkpoint === 'deck-ready' && !deck) throw new Error('已保存的幻灯片缺失');
    if (deck) { const errors = validateDeck(deck, paper); if (errors.length) throw new Error(errors.join('；')); }
    return { project, paper, asset: asset?.blob instanceof Blob ? asset : undefined, deck };
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
export function saveStage(captured: StageCapture, output: { checkpoint: 'pdf-parsed' | 'figures-ready'; paper: Paper }, signal: AbortSignal) {
  const paper = validatePaper(output.paper);
  const prior = output.checkpoint === 'pdf-parsed' ? 'project-created' : 'pdf-parsed';
  if (captured.checkpoint !== prior || paper.id !== captured.paperId || !paper.pages.length) throw new Error('阶段产物或顺序不正确');
  return transaction(['projects', 'papers', 'assets'], 'readwrite', async tx => {
    const project = await projectIn(tx, captured.id);
    if (project.checkpoint !== captured.checkpoint || project.paperId !== captured.paperId || project.pdfAssetId !== captured.pdfAssetId) throw new Error('项目阶段已在其他页面变化，请重新打开');
    if (!((await get<PdfAsset>(tx, 'assets', project.pdfAssetId))?.blob instanceof Blob)) throw new Error('原 PDF 缺失，无法保存本阶段');
    signal.throwIfAborted();
    const next: Project = { ...project, name: !project.nameIsCustom && paper.metadata.title ? paper.metadata.title : project.name, checkpoint: output.checkpoint, updatedAt: Date.now() };
    tx.objectStore('papers').put(paper, paper.id); tx.objectStore('projects').put(next, next.id);
    return next;
  }, signal);
}
export function saveRevision(projectId: string, previous: Deck, next: Deck, record: RevisionRecord, signal?: AbortSignal) {
  return transaction(['projects', 'papers', 'decks', 'history'], 'readwrite', async tx => {
    const project = await projectIn(tx, projectId);
    const current = project.currentDeckId && await get<Deck>(tx, 'decks', project.currentDeckId);
    if (!current || current.id !== previous.id || current.revision !== previous.revision || next.id !== current.id || next.revision !== current.revision + 1) throw new Error('项目已在其他页面修改，当前修改未保存。请重新打开最新项目。');
    if (await get(tx, 'history', record.id)) throw new Error('本次修改已经提交');
    const paper = validatePaper(await get(tx, 'papers', project.paperId));
    const errors = validateDeck(next, paper); if (errors.length) throw new Error(errors.join('；'));
    signal?.throwIfAborted();
    tx.objectStore('decks').put(next, next.id);
    tx.objectStore('projects').put({ ...project, updatedAt: next.updatedAt, lastOpenedSlideId: next.slides.some(slide => slide.id === project.lastOpenedSlideId) ? project.lastOpenedSlideId : next.slides[0]?.id }, projectId);
    tx.objectStore('history').add({ ...record, projectId }, record.id);
    const history = (await request(tx.objectStore('history').getAll()) as RevisionRecord[]).filter(item => item.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
    history.slice(100).forEach(item => tx.objectStore('history').delete(item.id));
  }, signal);
}
