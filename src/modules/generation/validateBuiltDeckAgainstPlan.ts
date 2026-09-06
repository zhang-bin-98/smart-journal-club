import type { Deck } from '../deck/deck.schema';
import type { DeckPlan } from '../outline/outline.schema';

/** 构建契约只检查确认计划的稳定字段，不混入叙事质量或布局视觉判断。 */
export function validateBuiltDeckAgainstPlan(deck: Deck, plan: DeckPlan): string[] {
  const errors: string[] = [];
  if (plan.status !== 'confirmed') errors.push('只有已确认计划可以构建');
  if (deck.paperId !== plan.paperId) errors.push('Deck 与计划论文不一致');
  if (deck.title !== plan.title || deck.language !== plan.language) errors.push('文稿标题或语言与确认计划不一致');
  if (deck.slides.length !== plan.slides.length) errors.push('生成页数与确认计划不一致');
  if (
    JSON.stringify(deck.sections.map((section) => section.id)) !==
    JSON.stringify(plan.sections.map((section) => section.id))
  )
    errors.push('生成章节顺序与确认计划不一致');
  plan.sections.forEach((section, index) => {
    const actual = deck.sections[index];
    if (
      !actual ||
      actual.kind !== section.kind ||
      actual.title !== section.title ||
      actual.purpose !== section.purpose ||
      actual.transitionToNext !== section.transitionToNext
    )
      errors.push(`章节内容不一致：${section.id}`);
  });
  plan.slides.forEach((planned, index) => {
    const actual = deck.slides[index];
    if (!actual) return;
    if (actual.id !== planned.id) errors.push(`页面 ID 不一致：${planned.id}`);
    if (actual.sectionId !== planned.sectionId) errors.push(`页面章节不一致：${planned.id}`);
    if (actual.title !== planned.title || actual.purpose !== planned.purpose || actual.message !== planned.message)
      errors.push(`页面叙事内容不一致：${planned.id}`);
    if (actual.kind !== planned.kind || actual.layoutId !== planned.layoutId)
      errors.push(`页面结构不一致：${planned.id}`);
    if (JSON.stringify(actual.claimIds) !== JSON.stringify(planned.claimIds))
      errors.push(`页面结论不一致：${planned.id}`);
    if (JSON.stringify(actual.sourceIds) !== JSON.stringify(planned.sourceIds))
      errors.push(`页面来源不一致：${planned.id}`);
    const figures = actual.elements
      .filter((element) => element.type === 'figure')
      .map((element) => [element.figureId, element.panelId]);
    if (actual.elements.some((element) => element.type === 'figure' && element.cropOverride !== undefined))
      errors.push(`生成图源不得带裁图覆盖：${planned.id}`);
    if (JSON.stringify(figures) !== JSON.stringify(planned.figures.map((figure) => [figure.figureId, figure.panelId])))
      errors.push(`页面图源不一致：${planned.id}`);
  });
  return errors;
}
