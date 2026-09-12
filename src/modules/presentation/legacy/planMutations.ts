import type { DeckPlan, PlanMutation, PlannedSlide } from './outline.schema';
import { OutlineError } from './outlineError';

function sectionIn(plan: DeckPlan, id: string) {
  const section = plan.sections.find((item) => item.id === id);
  if (!section) throw new OutlineError('unknown-section', '目标章节不存在。');
  return section;
}
function slideIn(plan: DeckPlan, id: string) {
  const slide = plan.slides.find((item) => item.id === id);
  if (!slide) throw new OutlineError('unknown-slide', '目标页面不存在。');
  return slide;
}
function assertNewId(plan: DeckPlan, id: string) {
  if (plan.sections.some((section) => section.id === id) || plan.slides.some((slide) => slide.id === id))
    throw new OutlineError('duplicate-id', '章节和页面 ID 必须唯一。');
}
function orderSlides(plan: DeckPlan) {
  plan.slides = plan.sections.flatMap((section) => plan.slides.filter((slide) => slide.sectionId === section.id));
}
function insertSlide(plan: DeckPlan, slide: PlannedSlide, afterSlideId: string | null) {
  sectionIn(plan, slide.sectionId);
  if (afterSlideId === slide.id) throw new OutlineError('invalid-position', '页面不能移动到自身之后。');
  if (afterSlideId !== null) {
    const after = slideIn(plan, afterSlideId);
    if (after.sectionId !== slide.sectionId) throw new OutlineError('invalid-position', '插入位置必须属于目标章节。');
    plan.slides.splice(plan.slides.indexOf(after) + 1, 0, slide);
  } else {
    plan.slides.unshift(slide);
  }
  orderSlides(plan);
}

/** 在请求副本上应用白名单操作；最终整批校验，页面操作永不隐式改预算或删除章节。 */
export function applyPlanMutation(plan: DeckPlan, mutation: PlanMutation) {
  switch (mutation.type) {
    case 'add-section': {
      assertNewId(plan, mutation.section.id);
      const after = mutation.afterSectionId === null ? undefined : sectionIn(plan, mutation.afterSectionId);
      plan.sections.splice(after ? plan.sections.indexOf(after) + 1 : 0, 0, structuredClone(mutation.section));
      break;
    }
    case 'delete-section': {
      const section = sectionIn(plan, mutation.sectionId);
      if (plan.slides.some((slide) => slide.sectionId === section.id))
        throw new OutlineError('section-not-empty', '请先在同批修改中移动或删除章节内页面。');
      plan.sections.splice(plan.sections.indexOf(section), 1);
      break;
    }
    case 'update-section':
      Object.assign(sectionIn(plan, mutation.sectionId), mutation.patch);
      break;
    case 'move-section': {
      const section = sectionIn(plan, mutation.sectionId);
      if (mutation.afterSectionId === section.id)
        throw new OutlineError('invalid-position', '章节不能移动到自身之后。');
      const after = mutation.afterSectionId === null ? undefined : sectionIn(plan, mutation.afterSectionId);
      plan.sections.splice(plan.sections.indexOf(section), 1);
      plan.sections.splice(after ? plan.sections.indexOf(after) + 1 : 0, 0, section);
      orderSlides(plan);
      break;
    }
    case 'set-slide-budget':
      sectionIn(plan, mutation.sectionId).slideBudget = mutation.slideBudget;
      break;
    case 'update-slide':
      Object.assign(slideIn(plan, mutation.slideId), mutation.patch);
      break;
    case 'add-slide':
      assertNewId(plan, mutation.slide.id);
      insertSlide(plan, structuredClone(mutation.slide), mutation.afterSlideId);
      break;
    case 'delete-slide': {
      const slide = slideIn(plan, mutation.slideId);
      plan.slides.splice(plan.slides.indexOf(slide), 1);
      break;
    }
    case 'move-slide': {
      const slide = slideIn(plan, mutation.slideId);
      plan.slides.splice(plan.slides.indexOf(slide), 1);
      slide.sectionId = mutation.targetSectionId;
      insertSlide(plan, slide, mutation.afterSlideId);
      break;
    }
    case 'set-claim-emphasis':
      plan.claimEmphasis = plan.claimEmphasis.filter((entry) => entry.claimId !== mutation.claimId);
      if (mutation.emphasis !== null)
        plan.claimEmphasis.push({ claimId: mutation.claimId, emphasis: mutation.emphasis });
      break;
  }
}
