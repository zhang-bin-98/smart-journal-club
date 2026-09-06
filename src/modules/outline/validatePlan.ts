import { DeckPlanSchema, type DeckPlan } from './outline.schema';
import { DeckSchemaVersion, type Deck } from '../deck/deck.schema';
import { validateDeck } from '../deck/validateDeck';
import type { Paper } from '../paper/paper.schema';
import { OutlineError } from './outlineError';

/** 草稿可保留空章、零页和预算差额；结构、引用及 omit 一致性始终校验。 */
export function validatePlan(input: unknown, paper: Paper): DeckPlan {
  const plan = DeckPlanSchema.parse(input);
  const errors: string[] = [];
  const ids = [...plan.sections.map((section) => section.id), ...plan.slides.map((slide) => slide.id)];
  if (new Set(ids).size !== ids.length) errors.push('章节和页面 ID 必须唯一');
  const emphasisIds = plan.claimEmphasis.map((entry) => entry.claimId);
  if (new Set(emphasisIds).size !== emphasisIds.length) errors.push('结论偏好不能重复');
  const knownClaims = new Set(paper.claims.map((claim) => claim.id));
  for (const entry of plan.claimEmphasis) {
    if (!knownClaims.has(entry.claimId)) errors.push(`结论偏好引用不存在：${entry.claimId}`);
    if (entry.emphasis === 'omit' && plan.slides.some((slide) => slide.claimIds.includes(entry.claimId)))
      errors.push(`不讲的结论仍被页面引用：${entry.claimId}`);
  }
  for (const slide of plan.slides) {
    if (new Set(slide.claimIds).size !== slide.claimIds.length) errors.push(`页面结论重复：${slide.id}`);
    if (new Set(slide.sourceIds).size !== slide.sourceIds.length) errors.push(`页面来源重复：${slide.id}`);
    const figures = slide.figures.map((figure) => JSON.stringify([figure.figureId, figure.panelId ?? null]));
    if (new Set(figures).size !== figures.length) errors.push(`页面图源重复：${slide.id}`);
  }
  const occupied = new Set(plan.slides.map((slide) => slide.sectionId));
  const generatedIds = new Set(ids);
  // 计划结构复用 Deck 结构校验：章节去掉预算、页面图源选择展开为 figure 元素。
  const candidate: Deck = {
    schemaVersion: DeckSchemaVersion,
    id: 'plan-validation',
    paperId: plan.paperId,
    revision: 0,
    title: plan.title,
    language: plan.language,
    sections: plan.sections.filter((section) => occupied.has(section.id)).map(({ slideBudget, ...section }) => section),
    slides: plan.slides.map(({ figures, ...slide }, slideIndex) => ({
      ...slide,
      elements: figures.map((figure, figureIndex) => {
        let id = `plan-figure-${slideIndex}-${figureIndex}`;
        while (generatedIds.has(id)) id += '_';
        generatedIds.add(id);
        return { id, type: 'figure' as const, ...figure };
      }),
    })),
    createdAt: 0,
    updatedAt: 0,
  };
  errors.push(...validateDeck(candidate, paper));
  if (errors.length) throw new OutlineError('invalid-plan', `汇报计划无效：${errors.join('；')}`);
  return plan;
}
