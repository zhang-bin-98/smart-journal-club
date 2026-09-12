import type { Deck } from '../../modules/presentation/editing/schema';
import type { FigureConsumer } from '../../app/paper/figureImpact';
import {
  applyPageSelection,
  applyUnitResult,
  getAnalysisProgress,
  getUnitInputKey,
  unitId,
} from '../../modules/paper/analysisUnits';
import { type AnalysisStage, type AnalysisUnitTarget, type Paper, validatePaper } from '../../modules/paper/model';
import { type Project, ProjectError } from '../../modules/project/model';
import { get, request, transaction } from './indexedDb';
import { openProject, paperIn, projectDataIn, projectIn } from './projectStore';
import { applyFigureCommand } from '../../modules/paper/figureEditing';
import type { FigureSave } from '../../app/paper/figureSession';

export type CommitUnitInput = {
  projectId: string;
  paperId: string;
  stage: AnalysisStage;
  target: AnalysisUnitTarget;
  inputKey: string;
  result: unknown;
  signal: AbortSignal;
  outcome?: 'completed' | 'no-figure-located';
};
export type PageSelectionInput = {
  projectId: string;
  documentId: string;
  pageNumber: number;
  manualOverride?: 'include' | 'exclude';
  expectedRevision: number;
  confirmRemoval?: boolean;
  paperId?: string;
};

async function referencedPaperIds(tx: IDBTransaction, project: Project) {
  const ids = new Set<string>();
  for (const id of [project.currentDeckId, project.previousDeckId, project.candidate?.deckId]) {
    if (!id) continue;
    const deck = await get<{ paperId: string }>(tx, 'decks', id);
    if (!deck) throw new ProjectError('missing-deck', '已保存稿件缺失，无法修改论文。');
    await paperIn(tx, project, deck.paperId);
    ids.add(deck.paperId);
  }
  const plan = await get<{ plan?: { paperId: string }; paperId?: string }>(tx, 'plans', project.id);
  const paperId = plan?.plan?.paperId ?? plan?.paperId;
  if (paperId) {
    await paperIn(tx, project, paperId);
    ids.add(paperId);
  }
  return ids;
}

/** 修改冻结底稿时先复制身份；旧稿、候选与计划始终读取自己的保存依据。 */
async function saveWorkingPaper(
  tx: IDBTransaction,
  project: Project,
  original: Paper,
  changed: Paper,
  captureBaseline = true,
) {
  const keep = await referencedPaperIds(tx, project);
  const paper = validatePaper({
    ...changed,
    id: keep.has(original.id) ? crypto.randomUUID() : original.id,
    projectId: project.id,
    revision: original.revision + 1,
  });
  const progress = getAnalysisProgress(paper);
  const geometrySources = paper.sources.filter((source) => source.kind === 'figure' || source.kind === 'panel');
  if (
    captureBaseline &&
    progress.figuresReady &&
    geometrySources.every((source) => source.geometryOrigin === 'automatic')
  ) {
    paper.figureReview.automaticBaseline = structuredClone({
      figures: paper.figures,
      sources: paper.sources.filter(
        (source) =>
          source.geometryOrigin === 'automatic' || (source.kind === 'caption' && source.textSpan !== undefined),
      ),
    });
  }
  const projectNext: Project = {
    ...project,
    paperId: paper.id,
    name: !project.nameIsCustom && paper.metadata.title ? paper.metadata.title : project.name,
    checkpoint: project.currentDeckId
      ? 'deck-ready'
      : progress.ready
        ? 'paper-ready'
        : progress.figuresReady
          ? 'figures-ready'
          : progress.textReady
            ? 'pdf-parsed'
            : project.checkpoint,
    updatedAt: Date.now(),
  };
  tx.objectStore('papers').put(paper, paper.id);
  tx.objectStore('projects').put(projectNext, projectNext.id);
  keep.add(paper.id);
  const papers = (await request(tx.objectStore('papers').getAll())) as Paper[];
  for (const candidate of papers)
    if (candidate.projectId === project.id && !keep.has(candidate.id)) tx.objectStore('papers').delete(candidate.id);
  return projectDataIn(tx, projectNext, paper);
}

/** 在写事务中重读每个单元实际输入，兄弟页乱序完成不会覆盖彼此。 */
export async function commitUnit(input: CommitUnitInput) {
  input.signal.throwIfAborted();
  return transaction(
    ['projects', 'papers', 'decks', 'plans', 'assets'],
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, input.projectId);
      const paper = await paperIn(tx, project);
      if (paper.id !== input.paperId) throw new ProjectError('stale-paper', '工作底稿已变化，旧分析结果未保存。');
      if (getUnitInputKey(paper, input.stage, input.target) !== input.inputKey)
        throw new ProjectError('stale-unit', '该分析单元的输入已变化，旧结果未保存。');
      const changed = applyUnitResult(paper, input);
      const id = unitId(input.stage, input.target);
      if (input.outcome === 'no-figure-located' && input.stage !== 'figure-location')
        throw new ProjectError('invalid-outcome', '只有成功的图源定位可以记录未定位到整图。');
      changed.analysisUnits = [
        ...changed.analysisUnits.filter((unit) => unit.id !== id),
        {
          id,
          stage: input.stage,
          target: input.target,
          inputKey: input.inputKey,
          outcome:
            input.outcome ??
            (input.stage === 'figure-location' && !(input.result as { figures?: unknown[] }).figures?.length
              ? 'no-figure-located'
              : 'completed'),
          completedAt: Date.now(),
        },
      ];
      input.signal.throwIfAborted();
      return saveWorkingPaper(tx, project, paper, changed);
    },
    input.signal,
  );
}

export async function setPageSelection(input: PageSelectionInput) {
  await openProject(input.projectId);
  return transaction(['projects', 'papers', 'decks', 'plans', 'assets'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, input.projectId);
    const paper = await paperIn(tx, project);
    if (input.paperId && paper.id !== input.paperId)
      throw new ProjectError('stale-paper', '工作底稿已变化，请重新核对页面选择。');
    const changed = applyPageSelection(paper, input);
    if (JSON.stringify(changed) === JSON.stringify(paper)) return projectDataIn(tx, project, paper);
    return saveWorkingPaper(tx, project, paper, changed);
  });
}

/** 运行开始前一次取得可编辑底稿，避免首批并行单元各自触发冻结复制。 */
export async function ensureWorkingPaper(projectId: string) {
  await openProject(projectId);
  return transaction(['projects', 'papers', 'decks', 'plans', 'assets'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, projectId);
    const paper = await paperIn(tx, project);
    const keep = await referencedPaperIds(tx, project);
    if (!keep.has(paper.id)) return projectDataIn(tx, project, paper);
    return saveWorkingPaper(tx, project, paper, paper);
  });
}

/** One atomic source edit; frozen manuscripts retain their original paper. */
export async function saveFigure(input: FigureSave) {
  input.assertCurrent();
  return transaction(['projects', 'papers', 'decks', 'plans', 'assets'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, input.projectId);
    const paper = await paperIn(tx, project);
    input.assertCurrent();
    if (
      paper.id !== input.paperId ||
      paper.revision !== input.revision ||
      paper.figureReview.revision !== input.reviewRevision
    )
      throw new ProjectError('stale-paper', '图源保存基准已变化，请保留输入并重新打开项目。');
    const next = applyFigureCommand(paper, input.command);
    if (next === paper) return projectDataIn(tx, project, paper);
    const result = await saveWorkingPaper(tx, project, paper, next, false);
    input.assertCurrent();
    return result;
  });
}

/** Read frozen manuscript references without changing the current workspace. */
export async function loadFigureConsumers(projectId: string): Promise<FigureConsumer[]> {
  return transaction(['projects', 'papers', 'decks'], 'readonly', async (tx) => {
    const project = await projectIn(tx, projectId);
    const result: FigureConsumer[] = [];
    for (const [label, id] of [
      ['当前稿', project.currentDeckId],
      ['上一版', project.previousDeckId],
    ]) {
      if (!id) continue;
      const deck = await get<Deck>(tx, 'decks', id);
      if (!deck) throw new ProjectError('missing-deck', '已保存稿件缺失。');
      result.push({ label: label!, deck, paper: await paperIn(tx, project, deck.paperId) });
    }
    return result;
  });
}
