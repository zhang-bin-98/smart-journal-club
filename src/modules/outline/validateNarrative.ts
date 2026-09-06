import type { DeckPlan } from './outline.schema';
import type { Deck } from '../deck/deck.schema';
import type { Paper } from '../paper/paper.schema';
import {
  contentIssues,
  deckNarrativeView,
  narrativeWarnings,
  planNarrativeView,
  planOnlyIssues,
  referenceIssues,
  skeletonIssues,
  structureIssues,
  type NarrativeIssue,
  type NarrativeValidation,
} from './narrativeRules';

const partition = (issues: NarrativeIssue[]): NarrativeValidation => ({
  errors: issues.filter((item) => item.severity === 'error'),
  warnings: issues.filter((item) => item.severity === 'warning'),
});

/** 计划叙事校验：骨架、内容职责、证据链与计划专属预算/omit 规则。错误表示可保存草稿但未来确认/生成应拒绝，由调用方执行门槛。 */
export function validatePlanNarrative(plan: DeckPlan, paper: Paper): NarrativeValidation {
  const view = planNarrativeView(plan);
  if (!view.slides.length)
    return plan.status === 'confirmed'
      ? partition([
          {
            code: 'empty-plan',
            severity: 'error',
            message: '已确认的计划至少需要一页。',
          },
        ])
      : partition([]);
  return partition([
    ...structureIssues(view),
    ...skeletonIssues(view, paper),
    ...contentIssues(view, paper, true),
    ...referenceIssues(view, paper),
    ...planOnlyIssues(view, plan, paper),
    ...narrativeWarnings(view),
  ]);
}

/** Deck 叙事校验：只依据 Deck 实际内容；不含计划预算、focus 偏好，也不检查构建忠实性。 */
export function validateDeckNarrative(deck: Deck, paper: Paper): NarrativeValidation {
  const view = deckNarrativeView(deck);
  if (!view.slides.length) return partition([{ code: 'empty-plan', severity: 'error', message: '文稿至少需要一页。' }]);
  return partition([
    ...structureIssues(view),
    ...skeletonIssues(view, paper),
    ...contentIssues(view, paper, false),
    ...referenceIssues(view, paper),
    ...narrativeWarnings(view),
  ]);
}
