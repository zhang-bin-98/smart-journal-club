import { get, stored, transaction } from '../../shared/persistence/indexedDb';
import { ProjectSchema, type Project } from '../project/project.schema';
import { DeckSchema, type Deck } from '../deck/deck.schema';
import { PaperSchema } from '../paper/paper.schema';
import { PlanRecordSchema, type GenerationBase, type PlanRecord } from '../outline/planRecord.schema';
import { assertPlanBase } from '../outline/outlineRepository';
import { validatePlan } from '../outline/validatePlan';
import { validateDeck } from '../deck/validateDeck';
import { validatePlanNarrative } from '../outline/validateNarrative';
import { OutlineError } from '../outline/outlineError';
import { validateBuiltDeckAgainstPlan } from './validateBuiltDeckAgainstPlan';

/** 开始规划前捕获数据库中的版本；Current 在候选期间仍可编辑。 */
export function captureGenerationBase(projectId: string) {
  return transaction(['projects', 'decks', 'plans'], 'readonly', async (tx) => {
    const project = stored(ProjectSchema, await get(tx, 'projects', projectId), '项目');
    if (project.checkpoint !== 'deck-ready' || !project.currentDeckId)
      throw new OutlineError('no-current', '当前项目尚无文稿。');
    if (await get(tx, 'plans', projectId)) throw new OutlineError('candidate-exists', '请先处理或放弃已有候选大纲。');
    const current = DeckSchema.parse(await get(tx, 'decks', project.currentDeckId));
    const previous = project.previousDeckId
      ? DeckSchema.parse(await get(tx, 'decks', project.previousDeckId))
      : undefined;
    return {
      current: { deckId: current.id, revision: current.revision },
      ...(previous ? { previous: { deckId: previous.id, revision: previous.revision } } : {}),
    } satisfies GenerationBase;
  });
}

export function saveCandidate(value: PlanRecord, signal: AbortSignal) {
  const record = PlanRecordSchema.parse(value);
  if (record.mode !== 'regeneration' || record.plan.status !== 'draft' || record.plan.revision !== 0)
    throw new OutlineError('invalid-candidate', '新候选必须为初始草稿。');
  return transaction(
    ['projects', 'papers', 'plans', 'decks'],
    'readwrite',
    async (tx) => {
      const project = stored(ProjectSchema, await get(tx, 'projects', record.projectId), '项目');
      await assertPlanBase(tx, record, project);
      if (await get(tx, 'plans', project.id)) throw new OutlineError('candidate-exists', '已有候选大纲，请重新打开。');
      validatePlan(record.plan, PaperSchema.parse(await get(tx, 'papers', project.paperId)));
      signal.throwIfAborted();
      tx.objectStore('plans').add(record, project.id);
      return record;
    },
    signal,
  );
}

/** 确认候选成功构建后才原子切换唯一两个版本、偏好及计划消费状态。 */
export function commitCandidate(captured: PlanRecord, deck: Deck, signal: AbortSignal) {
  return transaction(
    ['projects', 'papers', 'plans', 'decks', 'assets'],
    'readwrite',
    async (tx) => {
      const project = stored(ProjectSchema, await get(tx, 'projects', captured.projectId), '项目');
      const record = PlanRecordSchema.parse(await get(tx, 'plans', project.id));
      await assertPlanBase(tx, record, project);
      if (
        record.mode !== 'regeneration' ||
        record.plan.id !== captured.plan.id ||
        record.plan.revision !== captured.plan.revision
      )
        throw new OutlineError('stale-plan', '构建使用的大纲已变化。');
      const paper = PaperSchema.parse(await get(tx, 'papers', project.paperId));
      const errors = [...validateDeck(deck, paper), ...validateBuiltDeckAgainstPlan(deck, record.plan)];
      if (
        errors.length ||
        validatePlanNarrative(record.plan, paper).errors.length ||
        deck.revision !== 0 ||
        !deck.slides.length
      )
        throw new OutlineError('build-contract', '生成结果未遵循确认大纲。');
      const asset = await get<{ blob: Blob }>(tx, 'assets', project.pdfAssetId);
      if (!(asset?.blob instanceof Blob)) throw new OutlineError('missing-pdf', '原 PDF 缺失，不能提交生成结果。');
      if (deck.id === project.currentDeckId || deck.id === project.previousDeckId)
        throw new OutlineError('invalid-deck-id', '新文稿必须使用独立 ID。');
      const next: Project = {
        ...project,
        currentDeckId: deck.id,
        previousDeckId: project.currentDeckId,
        preferences: record.preferences,
        lastOpenedSlideId: deck.slides[0].id,
        updatedAt: Date.now(),
      };
      signal.throwIfAborted();
      tx.objectStore('decks').add(deck, deck.id);
      if (project.previousDeckId) tx.objectStore('decks').delete(project.previousDeckId);
      tx.objectStore('projects').put(next, project.id);
      tx.objectStore('plans').delete(project.id);
      return next;
    },
    signal,
  );
}

export function discardCandidate(projectId: string, planId: string, revision: number) {
  return transaction(['projects', 'plans'], 'readwrite', async (tx) => {
    stored(ProjectSchema, await get(tx, 'projects', projectId), '项目');
    const record = PlanRecordSchema.parse(await get(tx, 'plans', projectId));
    if (
      record.mode !== 'regeneration' ||
      record.projectId !== projectId ||
      record.plan.id !== planId ||
      record.plan.revision !== revision
    )
      throw new OutlineError('stale-plan', '候选大纲已变化，请重新打开。');
    tx.objectStore('plans').delete(projectId);
  });
}
