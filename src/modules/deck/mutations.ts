import type { Deck, DeckMutation, DeckSection, RevisionScope, Slide, SlideKind } from './deck.schema';
import { layoutCapacity } from './layoutRules';

const clone = <T>(value: T): T => structuredClone(value);
export function findSlide(deck: Deck, id: string) {
  const slide = deck.slides.find((item) => item.id === id);
  if (!slide) throw new Error(`找不到幻灯片：${id}`);
  return slide;
}
export function ensureScope(scope: RevisionScope, ids: string[], element?: { slideId: string; elementId: string }) {
  if (scope.type === 'deck') return;
  if (scope.type === 'slides' && ids.every((id) => scope.slideIds.includes(id))) return;
  if (scope.type === 'element' && element?.slideId === scope.slideId && element.elementId === scope.elementId) return;
  throw new Error('修改超出请求范围');
}
function fallbackLayout(slide: Slide) {
  const figures = slide.elements.filter((e) => e.type === 'figure').length;
  const text = slide.elements.filter((e) => e.type !== 'figure').length;
  if (!figures) return 'text-only' as const;
  if (figures === 1) return text ? ('figure-text' as const) : ('figure-full' as const);
  if (figures === 2) return 'two-figures' as const;
  return 'panel-grid' as const;
}
function firstIndexOfSection(slides: Slide[], sectionId: string) {
  const index = slides.findIndex((slide) => slide.sectionId === sectionId);
  return index < 0 ? undefined : index;
}
/** 空章节不得留在 Deck runtime：删去或移走章内最后一页时同步移除该章。 */
function removeSection(deck: Deck, sectionId: string) {
  if (deck.slides.some((slide) => slide.sectionId === sectionId)) return;
  deck.sections.splice(
    deck.sections.findIndex((section) => section.id === sectionId),
    1,
  );
}
function createCustomSection(slide: Slide): DeckSection {
  return { id: `${slide.id}-section`, kind: 'custom', title: '未命名章节', purpose: '' };
}
function insertIndexInSection(slides: Slide[], sectionId: string, afterSlideId: string | null) {
  if (afterSlideId === null) return firstIndexOfSection(slides, sectionId) ?? slides.length;
  const index = slides.findIndex((slide) => slide.id === afterSlideId);
  if (index < 0) throw new Error('插入位置不存在');
  if (slides[index].sectionId !== sectionId) throw new Error('插入位置不属于目标章节');
  return index + 1;
}
export function applyMutation(
  deck: Deck,
  mutation: DeckMutation,
): { affected: string[]; element?: { slideId: string; elementId: string } } {
  if (mutation.type === 'set-language') {
    deck.language = mutation.language.trim();
    return { affected: deck.slides.map((slide) => slide.id) };
  }
  if (mutation.type === 'add-slide') {
    if (deck.slides.some((s) => s.id === mutation.slide.id)) throw new Error('新增幻灯片 ID 已存在');
    const slide = clone(mutation.slide);
    if (!deck.sections.length) {
      // 完全空的 Deck 不允许孤立页：由领域入口创建唯一 custom 章并绑定新页。
      const section = createCustomSection(slide);
      deck.sections.push(section);
      slide.sectionId = section.id;
      deck.slides.push(slide);
      return { affected: [slide.id] };
    }
    if (!deck.sections.some((section) => section.id === slide.sectionId)) throw new Error('新增页面章节不存在');
    deck.slides.splice(insertIndexInSection(deck.slides, slide.sectionId, mutation.afterSlideId), 0, slide);
    return { affected: [slide.id] };
  }
  if (mutation.type === 'delete-slide') {
    const index = deck.slides.findIndex((s) => s.id === mutation.slideId);
    if (index < 0) throw new Error('删除目标不存在');
    const [removed] = deck.slides.splice(index, 1);
    removeSection(deck, removed.sectionId);
    return { affected: [mutation.slideId] };
  }
  if (mutation.type === 'move-slide') {
    const from = deck.slides.findIndex((s) => s.id === mutation.slideId);
    if (from < 0) throw new Error('移动目标不存在');
    if (mutation.afterSlideId === mutation.slideId) throw new Error('不能移动到自身之后');
    if (!deck.sections.some((section) => section.id === mutation.targetSectionId)) throw new Error('目标章节不存在');
    if (mutation.afterSlideId !== null) {
      const anchor = deck.slides.find((s) => s.id === mutation.afterSlideId);
      if (!anchor) throw new Error('插入位置不存在');
      if (anchor.sectionId !== mutation.targetSectionId) throw new Error('插入位置不属于目标章节');
    }
    const [slide] = deck.slides.splice(from, 1);
    const previousSectionId = slide.sectionId;
    slide.sectionId = mutation.targetSectionId;
    const index =
      mutation.afterSlideId !== null
        ? deck.slides.findIndex((s) => s.id === mutation.afterSlideId) + 1
        : (firstIndexOfSection(deck.slides, mutation.targetSectionId) ?? from);
    deck.slides.splice(index, 0, slide);
    removeSection(deck, previousSectionId);
    return { affected: [mutation.slideId] };
  }
  const slide = findSlide(deck, mutation.slideId);
  if (mutation.type === 'update-slide') {
    // 页面归属只能通过 move-slide 变化，update-slide 白名单外的字段在 Schema 层已拒绝。
    if ('sectionId' in mutation.changes) throw new Error('页面章节归属不能直接修改');
    Object.assign(slide, clone(mutation.changes));
    return { affected: [slide.id] };
  }
  if (mutation.type === 'add-element') {
    if (deck.slides.some((s) => s.elements.some((e) => e.id === mutation.element.id)))
      throw new Error('新增元素 ID 已存在');
    slide.elements.push(clone(mutation.element));
    return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } };
  }
  const index = slide.elements.findIndex(
    (e) => e.id === (mutation.type === 'replace-element' ? mutation.element.id : mutation.elementId),
  );
  if (mutation.type === 'replace-element') {
    if (index < 0) throw new Error('替换目标不存在');
    const previous = slide.elements[index];
    const next = clone(mutation.element);
    if (
      previous.type === 'figure' &&
      next.type === 'figure' &&
      (previous.figureId !== next.figureId || previous.panelId !== next.panelId)
    )
      delete next.cropOverride;
    slide.elements[index] = next;
    return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } };
  }
  if (index < 0) throw new Error('删除目标不存在');
  slide.elements.splice(index, 1);
  if (!layoutCapacity(slide)) slide.layoutId = fallbackLayout(slide);
  return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.elementId } };
}
export function createSlide(id: string, number: number, sectionId = ''): Slide {
  return {
    id,
    // 空 Deck 新增时由领域层创建唯一 custom 章；占位归属与派生规则保持一致。
    sectionId: sectionId || `${id}-section`,
    kind: 'custom' as SlideKind,
    title: `新幻灯片 ${number}`,
    layoutId: 'text-only',
    elements: [{ id: `${id}-text`, type: 'text', text: '' }],
    claimIds: [],
    sourceIds: [],
  };
}
