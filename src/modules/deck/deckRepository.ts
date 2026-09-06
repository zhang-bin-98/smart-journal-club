import { get, request, stored, transaction } from '../../shared/persistence/indexedDb';
import { DeckSchema, RevisionRecordSchema, type Deck, type RevisionRecord, type RevisionRequest } from './deck.schema';
import type { ChatMessage } from '../assistant/assistant.schema';
import { PaperSchema, type Paper } from '../paper/paper.schema';
import { ProjectSchema, type PdfAsset, type Project } from '../project/project.schema';
import { projectIn } from '../project/projectRepository';
import { assertMessage, trimHistory } from '../../shared/persistence/historyStore';
import { validateDeck } from './validateDeck';
import { validatePaper } from '../paper/sources';
import { prompts } from '../../shared/llm/prompts';

export type VersionCapture = {
  projectId: string;
  paperId: string;
  pdfAssetId: string;
  currentDeckId: string;
  baseRevision: number;
  previousDeckId?: string;
};
export function captureVersion(project: Project, deck: Deck): VersionCapture {
  if (
    project.checkpoint !== 'deck-ready' ||
    project.currentDeckId !== deck.id ||
    project.paperId !== deck.paperId ||
    project.previousDeckId === deck.id
  )
    throw new Error('当前版本或项目关联已变化，请重新打开项目。');
  return {
    projectId: project.id,
    paperId: project.paperId,
    pdfAssetId: project.pdfAssetId,
    currentDeckId: deck.id,
    baseRevision: deck.revision,
    previousDeckId: project.previousDeckId,
  };
}
function assertVersionTask(signal?: AbortSignal, isTaskActive?: () => boolean) {
  signal?.throwIfAborted();
  if (isTaskActive && !isTaskActive()) throw new Error('版本操作已失效，现有成果仍保留。');
}
async function versionIn(tx: IDBTransaction, captured: VersionCapture) {
  const project = await projectIn(tx, captured.projectId);
  if (
    project.checkpoint !== 'deck-ready' ||
    project.currentDeckId !== captured.currentDeckId ||
    project.previousDeckId !== captured.previousDeckId ||
    project.paperId !== captured.paperId ||
    project.pdfAssetId !== captured.pdfAssetId
  )
    throw new Error('项目版本已在其他页面变化，请重新打开最新项目。');
  const paper = validatePaper(stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文'), true);
  if (paper.id !== project.paperId) throw new Error('论文关联不一致');
  const current = stored(DeckSchema, await get(tx, 'decks', captured.currentDeckId), '当前幻灯片');
  if (
    current.id !== captured.currentDeckId ||
    current.revision !== captured.baseRevision ||
    current.id === project.previousDeckId
  )
    throw new Error('当前幻灯片已在其他页面修改，请重新打开最新项目。');
  const errors = validateDeck(current, paper);
  if (errors.length) throw new Error(errors.join('；'));
  return { project, paper, current };
}
async function previousIn(tx: IDBTransaction, project: Project, paper: Paper) {
  if (!project.previousDeckId) throw new Error('当前项目没有可恢复的上一版。');
  const previous = stored(DeckSchema, await get(tx, 'decks', project.previousDeckId), '上一版幻灯片');
  if (previous.id !== project.previousDeckId || previous.id === project.currentDeckId)
    throw new Error('上一版关联无效，请保留项目并检查本地存储。');
  const errors = validateDeck(previous, paper);
  if (errors.length) throw new Error(errors.join('；'));
  return previous;
}
/** 新版本与两个版本指针一起提交；未完成的计划和偏好不进入存储。 */
export function commitRegeneration(
  captured: VersionCapture,
  newDeck: Deck,
  preferences: Project['preferences'],
  signal: AbortSignal,
  isTaskActive?: () => boolean,
) {
  const deck = DeckSchema.parse(structuredClone(newDeck));
  const savedPreferences = ProjectSchema.shape.preferences.parse(structuredClone(preferences));
  if (
    deck.revision !== 0 ||
    !deck.slides.length ||
    deck.id === captured.currentDeckId ||
    deck.id === captured.previousDeckId
  )
    throw new Error('重生成必须提供新 ID、初始版本号和完整幻灯片。');
  if (!prompts.strategies.some((strategy) => strategy.id === savedPreferences.strategyId))
    throw new Error('研究叙事策略不存在');
  assertVersionTask(signal, isTaskActive);
  return transaction(
    ['projects', 'papers', 'decks', 'assets'],
    'readwrite',
    async (tx) => {
      const { project, paper, current } = await versionIn(tx, captured);
      if (!((await get<PdfAsset>(tx, 'assets', project.pdfAssetId))?.blob instanceof Blob))
        throw new Error('原 PDF 缺失，无法保存重生成结果。');
      const errors = validateDeck(deck, paper);
      if (errors.length) throw new Error(errors.join('；'));
      if (project.previousDeckId) await previousIn(tx, project, paper);
      assertVersionTask(signal, isTaskActive);
      const next = ProjectSchema.parse({
        ...project,
        currentDeckId: deck.id,
        previousDeckId: current.id,
        preferences: savedPreferences,
        lastOpenedSlideId: deck.slides[0].id,
        updatedAt: Date.now(),
      });
      tx.objectStore('decks').add(deck, deck.id);
      if (project.previousDeckId) tx.objectStore('decks').delete(project.previousDeckId);
      await request(tx.objectStore('projects').put(next, next.id));
      assertVersionTask(signal, isTaskActive);
      return { project: next, deck };
    },
    signal,
  );
}
/** 交换唯一两个版本；恢复对象自己的 revision 递增，避免接受此前的旧响应。 */
export function restorePrevious(captured: VersionCapture, signal?: AbortSignal, isTaskActive?: () => boolean) {
  assertVersionTask(signal, isTaskActive);
  return transaction(
    ['projects', 'papers', 'decks'],
    'readwrite',
    async (tx) => {
      const { project, paper, current } = await versionIn(tx, captured);
      const previous = await previousIn(tx, project, paper);
      const now = Date.now();
      const deck = { ...previous, revision: previous.revision + 1, updatedAt: now };
      const next = ProjectSchema.parse({
        ...project,
        currentDeckId: deck.id,
        previousDeckId: current.id,
        lastOpenedSlideId: deck.slides[0]?.id,
        updatedAt: now,
      });
      assertVersionTask(signal, isTaskActive);
      tx.objectStore('decks').put(deck, deck.id);
      await request(tx.objectStore('projects').put(next, next.id));
      assertVersionTask(signal, isTaskActive);
      return { project: next, deck };
    },
    signal,
  );
}

export function saveRevision(
  projectId: string,
  previous: Deck,
  next: Deck,
  record: RevisionRecord,
  signal?: AbortSignal,
  guard?: { isTaskActive?: () => boolean; messages?: ChatMessage[] },
) {
  return transaction(
    ['projects', 'papers', 'decks', 'history'],
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, projectId);
      const current = project.currentDeckId
        ? stored(DeckSchema, await get(tx, 'decks', project.currentDeckId), '当前幻灯片')
        : undefined;
      if (
        !current ||
        current.id !== previous.id ||
        current.revision !== previous.revision ||
        next.id !== current.id ||
        next.revision !== current.revision + 1
      )
        throw new Error('项目已在其他页面修改，当前修改未保存。请重新打开最新项目。');
      if (record.projectId && record.projectId !== projectId) throw new Error('修改请求项目不匹配');
      if (
        record.deckId !== next.id ||
        record.baseRevision !== previous.revision ||
        record.committedRevision !== next.revision ||
        !record.id
      )
        throw new Error('修改请求绑定的版本无效');
      if (await get(tx, 'history', record.id)) throw new Error('本次修改已经提交');
      const paper = validatePaper(stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文'));
      const errors = validateDeck(next, paper);
      if (errors.length) throw new Error(errors.join('；'));
      signal?.throwIfAborted();
      if (guard?.isTaskActive && !guard.isTaskActive()) throw new Error('修改请求已失效');
      tx.objectStore('decks').put(next, next.id);
      tx.objectStore('projects').put(
        {
          ...project,
          updatedAt: next.updatedAt,
          lastOpenedSlideId: next.slides.some((slide) => slide.id === project.lastOpenedSlideId)
            ? project.lastOpenedSlideId
            : next.slides[0]?.id,
        },
        projectId,
      );
      tx.objectStore('history').add(RevisionRecordSchema.parse({ ...record, projectId }), record.id);
      for (const message of guard?.messages ?? []) {
        assertMessage(message, projectId, previous);
        if (message.revision !== undefined && message.revision !== next.revision) throw new Error('对话修改版本不匹配');
        tx.objectStore('history').add(message, message.id);
      }
      await trimHistory(tx, projectId);
      signal?.throwIfAborted();
      if (guard?.isTaskActive && !guard.isTaskActive()) throw new Error('修改请求已失效');
    },
    signal,
  );
}

export type RevisionReadContext = RevisionRequest;
export function captureRevision(projectId: string, deck: Deck): RevisionReadContext {
  return { requestId: crypto.randomUUID(), projectId, deckId: deck.id, baseRevision: deck.revision };
}
export function getDeck(projectId: string) {
  return transaction(['projects', 'papers', 'decks'], 'readonly', async (tx) => {
    const project = await projectIn(tx, projectId);
    const paper = stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文');
    if (!project.currentDeckId) throw new Error('项目尚未生成幻灯片');
    const deck = DeckSchema.parse(await get(tx, 'decks', project.currentDeckId));
    const errors = validateDeck(deck, paper);
    if (errors.length) throw new Error(errors.join('；'));
    return structuredClone(deck);
  });
}
