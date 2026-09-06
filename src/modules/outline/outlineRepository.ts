import { get, transaction } from '../../shared/persistence/indexedDb';
import { projectIn } from '../project/projectRepository';
import { validatePlan } from './validatePlan';
import { PlanRecordSchema } from './planRecord.schema';
import { PlanRequestSchema, type DeckPlan, type PlanRequest } from './outline.schema';
import { PaperSchema } from '../paper/paper.schema';
import { OutlineError } from './outlineError';

/** 在同一事务中复核计划基准；旧标签页、取消或验证失败均不改已保存成果。 */
export function savePlanRevision(request: PlanRequest, next: DeckPlan, signal?: AbortSignal) {
  const captured = PlanRequestSchema.parse(request);
  return transaction(
    ['projects', 'papers', 'plans'],
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, captured.projectId);
      const record = PlanRecordSchema.parse(await get(tx, 'plans', project.id));
      if (
        record.projectId !== project.id ||
        record.plan.id !== captured.planId ||
        record.plan.revision !== captured.baseRevision
      )
        throw new OutlineError('stale-plan', '计划已在其他页面修改，请重新打开最新计划。');
      if (
        next.id !== record.plan.id ||
        next.paperId !== record.plan.paperId ||
        next.revision !== record.plan.revision + 1
      )
        throw new OutlineError('invalid-revision', '计划提交版本不正确。');
      const paper = PaperSchema.parse(await get(tx, 'papers', project.paperId));
      validatePlan(next, paper);
      signal?.throwIfAborted();
      tx.objectStore('plans').put({ ...record, plan: next }, project.id);
      tx.objectStore('projects').put({ ...project, updatedAt: next.updatedAt }, project.id);
      return next;
    },
    signal,
  );
}
