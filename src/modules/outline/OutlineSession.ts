import type { Paper } from '../paper/paper.schema';
import { validatePlanNarrative } from './validateNarrative';
import {
  PlanCommitRequestSchema,
  PlanRequestSchema,
  type DeckPlan,
  type PlanCommitRequest,
  type PlanRequest,
} from './outline.schema';
import { applyPlanMutation } from './planMutations';
import { validatePlan } from './validatePlan';
import { OutlineError } from './outlineError';
const clone = <T>(value: T): T => structuredClone(value);
export type PlanSaveOptions = {
  signal?: AbortSignal;
  isTaskActive?: () => boolean;
  warningsAccepted?: boolean;
  command?: 'edit' | 'confirm';
};
export type PersistPlan = (request: PlanRequest, next: DeckPlan, options: PlanSaveOptions) => Promise<DeckPlan>;
type PlanSnapshot = Pick<DeckPlan, 'title' | 'language' | 'sections' | 'slides' | 'claimEmphasis'>;
const snapshot = (plan: DeckPlan): PlanSnapshot =>
  clone({
    title: plan.title,
    language: plan.language,
    sections: plan.sections,
    slides: plan.slides,
    claimEmphasis: plan.claimEmphasis,
  });
function draftOf(plan: DeckPlan): DeckPlan {
  if (plan.status === 'draft') return clone(plan);
  const { confirmedAt, ...value } = plan;
  return { ...clone(value), status: 'draft' };
}

/** 计划唯一提交入口：先在副本上校验并持久化，成功后才更新内存及有限会话历史。 */
export class OutlineSession {
  private value: DeckPlan;
  private saving = false;
  private undoStack: PlanSnapshot[] = [];
  private redoStack: PlanSnapshot[] = [];
  private requests = new Set<string>();
  constructor(
    initial: DeckPlan,
    private readonly paper: Paper,
    private readonly projectId: string,
    private readonly persist?: PersistPlan,
  ) {
    this.value = clone(validatePlan(initial, paper));
  }
  get current() {
    return clone(this.value);
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  capture(): PlanRequest {
    return {
      requestId: crypto.randomUUID(),
      projectId: this.projectId,
      planId: this.value.id,
      baseRevision: this.value.revision,
    };
  }
  private assertRequest(input: PlanRequest, options: PlanSaveOptions) {
    const request = PlanRequestSchema.parse(input);
    options.signal?.throwIfAborted();
    if (options.isTaskActive && !options.isTaskActive()) throw new OutlineError('inactive-request', '计划操作已失效。');
    if (this.saving) throw new OutlineError('saving', '正在保存计划，请稍后重试。');
    if (this.requests.has(request.requestId)) throw new OutlineError('duplicate-request', '本次修改已经提交。');
    if (
      request.projectId !== this.projectId ||
      request.planId !== this.value.id ||
      request.baseRevision !== this.value.revision
    )
      throw new OutlineError('stale-plan', '计划目标或版本已变化，请重新打开大纲。');
    return request;
  }
  private async save(request: PlanRequest, candidate: DeckPlan, options: PlanSaveOptions) {
    this.assertRequest(request, options);
    const next = validatePlan(candidate, this.paper);
    next.revision = this.value.revision + 1;
    next.updatedAt = Date.now();
    this.saving = true;
    try {
      await this.persist?.(request, clone(next), options);
      this.value = clone(next);
      this.requests.add(request.requestId);
      if (this.requests.size > 100) this.requests.delete(this.requests.values().next().value!);
    } finally {
      this.saving = false;
    }
  }
  async commit(input: PlanCommitRequest, options: PlanSaveOptions = {}) {
    const { mutations, ...request } = PlanCommitRequestSchema.parse(input);
    this.assertRequest(request, options);
    const previous = snapshot(this.value);
    const next = draftOf(this.value);
    for (const mutation of mutations) applyPlanMutation(next, mutation);
    await this.save(request, next, { ...options, command: 'edit' });
    this.undoStack.push(previous);
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.redoStack = [];
    return this.current;
  }
  async confirm(request: PlanRequest, options: PlanSaveOptions = {}) {
    this.assertRequest(request, options);
    if (this.value.status === 'confirmed') return this.current;
    const candidate = { ...clone(this.value), status: 'confirmed' as const, confirmedAt: Date.now() };
    const result = validatePlanNarrative(candidate, this.paper);
    if (result.errors.length)
      throw new OutlineError(
        'narrative-errors',
        `计划无法确认：${result.errors.map((item) => item.message).join('；')}`,
      );
    if (result.warnings.length && !options.warningsAccepted)
      throw new OutlineError('warnings-unconfirmed', '请检查大纲警告并确认继续。');
    await this.save(request, candidate, { ...options, command: 'confirm' });
    return this.current;
  }
  private async restore(direction: 'undo' | 'redo', options: PlanSaveOptions) {
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    if (!from.length) return false;
    const previous = snapshot(this.value);
    const next = { ...draftOf(this.value), ...clone(from.at(-1)!) };
    await this.save(this.capture(), next, { ...options, command: 'edit' });
    from.pop();
    to.push(previous);
    if (to.length > 20) to.shift();
    return true;
  }
  undo(options: PlanSaveOptions = {}) {
    return this.restore('undo', options);
  }
  redo(options: PlanSaveOptions = {}) {
    return this.restore('redo', options);
  }
}
