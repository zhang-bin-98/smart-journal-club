import { get, request as idbRequest, stored, transaction } from '../../shared/persistence/indexedDb';
import { ProjectSchema, type Project } from '../project/project.schema';
import { validatePlan } from './validatePlan';
import { PlanRecordSchema, type PlanRecord } from './planRecord.schema';
import { PlanRequestSchema, type DeckPlan, type PlanRequest } from './outline.schema';
import { PaperSchema } from '../paper/paper.schema';
import { OutlineError } from './outlineError';
import type { PlanSaveOptions } from './OutlineSession';
import { DeckSchema } from '../deck/deck.schema';
import { validatePlanNarrative } from './validateNarrative';
import { trimHistory } from '../../shared/persistence/historyStore';

function assertActive(options: PlanSaveOptions) {
  options.signal?.throwIfAborted();
  if (options.isTaskActive && !options.isTaskActive()) throw new OutlineError('inactive-request', '计划操作已失效。');
}

/** 候选可保持可读；编辑、确认及构建必须复核两个版本指针和 revision。 */
export async function assertPlanBase(tx: IDBTransaction, record: PlanRecord, project: Project) {
  if (record.projectId !== project.id || record.plan.paperId !== project.paperId)
    throw new OutlineError('invalid-association', '计划与当前项目的论文关联不一致。');
  if (record.mode === 'initial') {
    if (project.checkpoint !== 'deck-plan-ready' || project.currentDeckId)
      throw new OutlineError('stale-plan', '项目阶段已变化，请重新打开项目。');
    return;
  }
  if (
    project.checkpoint !== 'deck-ready' ||
    project.currentDeckId !== record.base.current.deckId ||
    project.previousDeckId !== record.base.previous?.deckId
  )
    throw new OutlineError('stale-candidate', '候选大纲的基准已变化，请放弃候选后重新规划。');
  for (const pointer of [record.base.current, record.base.previous]) {
    if (!pointer) continue;
    const deck = DeckSchema.parse(await get(tx, 'decks', pointer.deckId));
    if (deck.id !== pointer.deckId || deck.paperId !== project.paperId || deck.revision !== pointer.revision)
      throw new OutlineError('stale-candidate', '候选大纲的基准已变化，请放弃候选后重新规划。');
  }
}

function content(plan: DeckPlan) {
  return JSON.stringify([plan.title, plan.language, plan.sections, plan.slides, plan.claimEmphasis]);
}

/** 在同一事务中复核计划基准；旧标签页、取消或验证失败均不改已保存成果。 */
export function savePlanRevision(request: PlanRequest, value: DeckPlan, options: PlanSaveOptions = {}) {
  const captured = PlanRequestSchema.parse(request);
  const candidate = structuredClone(value);
  assertActive(options);
  return transaction(
    ['projects', 'papers', 'plans', 'decks', 'history'],
    'readwrite',
    async (tx) => {
      const project = stored(ProjectSchema, await get(tx, 'projects', captured.projectId), '项目');
      const record = PlanRecordSchema.parse(await get(tx, 'plans', project.id));
      await assertPlanBase(tx, record, project);
      if (await get(tx, 'history', captured.requestId))
        throw new OutlineError('duplicate-request', '本次修改已经提交。');
      if (
        record.projectId !== project.id ||
        record.plan.id !== captured.planId ||
        record.plan.revision !== captured.baseRevision
      )
        throw new OutlineError('stale-plan', '计划已在其他页面修改，请重新打开最新计划。');
      if (
        candidate.id !== record.plan.id ||
        candidate.paperId !== record.plan.paperId ||
        candidate.createdAt !== record.plan.createdAt ||
        candidate.revision !== record.plan.revision + 1
      )
        throw new OutlineError('invalid-revision', '计划提交版本不正确。');
      const paper = PaperSchema.parse(await get(tx, 'papers', project.paperId));
      const next = validatePlan(candidate, paper);
      if (options.command === 'confirm') {
        if (record.plan.status !== 'draft' || next.status !== 'confirmed' || content(next) !== content(record.plan))
          throw new OutlineError('invalid-confirmation', '确认只能授权当前未修改的大纲。');
        const issues = validatePlanNarrative(next, paper);
        if (issues.errors.length) throw new OutlineError('narrative-errors', '大纲仍有错误，无法确认。');
        if (issues.warnings.length && !options.warningsAccepted)
          throw new OutlineError('warnings-unconfirmed', '请检查大纲警告并确认继续。');
      } else if (next.status !== 'draft') {
        throw new OutlineError('invalid-confirmation', '内容修改必须回到草稿。');
      }
      assertActive(options);
      tx.objectStore('plans').put({ ...record, plan: next }, project.id);
      tx.objectStore('projects').put({ ...project, updatedAt: next.updatedAt }, project.id);
      await idbRequest(
        tx.objectStore('history').add(
          {
            kind: 'plan-revision',
            id: captured.requestId,
            projectId: project.id,
            planId: next.id,
            baseRevision: record.plan.revision,
            committedRevision: next.revision,
            createdAt: next.updatedAt,
          },
          captured.requestId,
        ),
      );
      await trimHistory(tx, project.id);
      assertActive(options);
      return next;
    },
    options.signal,
  );
}
