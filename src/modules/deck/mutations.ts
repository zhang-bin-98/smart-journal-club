import type { Deck, DeckMutation, RevisionScope, Slide, SlideKind } from './deck.schema';
import { layoutCapacity } from './layoutRules';

const clone = <T>(value: T): T => structuredClone(value);
export function findSlide(deck: Deck, id: string) { const slide = deck.slides.find(item => item.id === id); if (!slide) throw new Error(`找不到幻灯片：${id}`); return slide; }
export function ensureScope(scope: RevisionScope, ids: string[], element?: { slideId: string; elementId: string }) {
  if (scope.type === 'deck') return;
  if (scope.type === 'slides' && ids.every(id => scope.slideIds.includes(id))) return;
  if (scope.type === 'element' && element?.slideId === scope.slideId && element.elementId === scope.elementId) return;
  throw new Error('修改超出请求范围');
}
function fallbackLayout(slide: Slide) {
  const figures = slide.elements.filter(e => e.type === 'figure').length; const text = slide.elements.filter(e => e.type !== 'figure').length;
  if (!figures) return 'text-only' as const; if (figures === 1) return text ? 'figure-text' as const : 'figure-full' as const;
  if (figures === 2) return 'two-figures' as const; return 'panel-grid' as const;
}
function insertIndex(slides: Slide[], afterSlideId: string | null) {
  if (afterSlideId === null) return 0; const index = slides.findIndex(slide => slide.id === afterSlideId); if (index < 0) throw new Error('插入位置不存在'); return index + 1;
}
export function applyMutation(deck: Deck, mutation: DeckMutation): { affected: string[]; element?: { slideId: string; elementId: string } } {
  if (mutation.type === 'set-language') { deck.language = mutation.language.trim(); return { affected: deck.slides.map(slide => slide.id) }; }
  if (mutation.type === 'add-slide') { if (deck.slides.some(s => s.id === mutation.slide.id)) throw new Error('新增幻灯片 ID 已存在'); deck.slides.splice(insertIndex(deck.slides, mutation.afterSlideId), 0, clone(mutation.slide)); return { affected: [mutation.slide.id] }; }
  if (mutation.type === 'delete-slide') { const index = deck.slides.findIndex(s => s.id === mutation.slideId); if (index < 0) throw new Error('删除目标不存在'); deck.slides.splice(index, 1); return { affected: [mutation.slideId] }; }
  if (mutation.type === 'move-slide') { const from = deck.slides.findIndex(s => s.id === mutation.slideId); if (from < 0) throw new Error('移动目标不存在'); if (mutation.afterSlideId === mutation.slideId) throw new Error('不能移动到自身之后'); const [slide] = deck.slides.splice(from, 1); deck.slides.splice(insertIndex(deck.slides, mutation.afterSlideId), 0, slide); return { affected: [mutation.slideId] }; }
  const slide = findSlide(deck, mutation.slideId);
  if (mutation.type === 'update-slide') { Object.assign(slide, clone(mutation.changes)); return { affected: [slide.id] }; }
  if (mutation.type === 'add-element') { if (deck.slides.some(s => s.elements.some(e => e.id === mutation.element.id))) throw new Error('新增元素 ID 已存在'); slide.elements.push(clone(mutation.element)); return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } }; }
  const index = slide.elements.findIndex(e => e.id === (mutation.type === 'replace-element' ? mutation.element.id : mutation.elementId));
  if (mutation.type === 'replace-element') {
    if (index < 0) throw new Error('替换目标不存在');
    const previous = slide.elements[index]; const next = clone(mutation.element);
    if (previous.type === 'figure' && next.type === 'figure' && (previous.figureId !== next.figureId || previous.panelId !== next.panelId)) delete next.cropOverride;
    slide.elements[index] = next;
    return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } };
  }
  if (index < 0) throw new Error('删除目标不存在');
  slide.elements.splice(index, 1);
  if (!layoutCapacity(slide)) slide.layoutId = fallbackLayout(slide);
  return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.elementId } };
}
export function createSlide(id: string, number: number): Slide { return { id, kind: 'custom' as SlideKind, title: `新幻灯片 ${number}`, layoutId: 'text-only', elements: [{ id: `${id}-text`, type: 'text', text: '' }], claimIds: [], sourceIds: [] }; }
