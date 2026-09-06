import type { Paper } from '../paper/paper.schema';
import { validatePlanNarrative } from './validateNarrative';
import { DeckPlanSchema, type DeckPlan } from './outline.schema';

export type PlanMutation = (draft: DeckPlan) => void;
const clone = <T>(value: T): T => structuredClone(value);

/** 计划的唯一内存提交入口；草稿允许叙事问题，确认要求无硬错误且预算一致。 */
export class OutlineSession {
  current: DeckPlan;
  private readonly paper: Paper;
  constructor(initial: DeckPlan, paper: Paper) {
    this.current = clone(DeckPlanSchema.parse(initial));
    this.paper = paper;
  }
  commit(mutation: PlanMutation) {
    let next = clone(this.current);
    mutation(next);
    next.status = 'draft';
    const draftPlan = { ...next } as DeckPlan & { confirmedAt?: number };
    delete draftPlan.confirmedAt;
    next = draftPlan;
    next.revision += 1;
    next.updatedAt = Date.now();
    this.current = DeckPlanSchema.parse(next);
    return clone(this.current);
  }
  confirm() {
    if (this.current.status === 'confirmed') return clone(this.current);
    const candidate = { ...clone(this.current), status: 'confirmed' as const, confirmedAt: Date.now() };
    const result = validatePlanNarrative(candidate, this.paper);
    if (result.errors.length) throw new Error(`计划无法确认：${result.errors.map((item) => item.message).join('；')}`);
    const next = candidate;
    next.revision += 1;
    next.updatedAt = Date.now();
    this.current = DeckPlanSchema.parse(next);
    return clone(this.current);
  }
}
