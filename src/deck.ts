import { validateDeck } from './layout';
import type { Deck, Element, Paper, Slide, SlideKind } from './types';
export type RevisionScope = { type: 'element'; slideId: string; elementId: string } | { type: 'slides'; slideIds: string[] } | { type: 'deck' };
export type DeckMutation =
  | { type: 'add-slide'; slide: Slide; afterSlideId: string | null }
  | { type: 'delete-slide'; slideId: string }
  | { type: 'move-slide'; slideId: string; afterSlideId: string | null }
  | { type: 'update-slide'; slideId: string; changes: Partial<Pick<Slide, 'kind' | 'title' | 'message' | 'layoutId'>> }
  | { type: 'add-element'; slideId: string; element: Element }
  | { type: 'replace-element'; slideId: string; element: Element }
  | { type: 'delete-element'; slideId: string; elementId: string };
export type DeckSnapshot = Pick<Deck, 'title' | 'language' | 'slides'>;
const clone = <T>(value: T): T => structuredClone(value);
const snapshot = (deck: Deck): DeckSnapshot => clone({ title: deck.title, language: deck.language, slides: deck.slides });
function findSlide(deck: Deck, id: string) { const slide = deck.slides.find(item => item.id === id); if (!slide) throw new Error('找不到幻灯片：' + id); return slide; }
function ensureScope(scope: RevisionScope, ids: string[], element?: { slideId: string; elementId: string }) {
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
function applyMutation(deck: Deck, mutation: DeckMutation): { affected: string[]; element?: { slideId: string; elementId: string } } {
  if (mutation.type === 'add-slide') { if (deck.slides.some(s => s.id === mutation.slide.id)) throw new Error('新增幻灯片 ID 已存在'); deck.slides.splice(insertIndex(deck.slides, mutation.afterSlideId), 0, clone(mutation.slide)); return { affected: [mutation.slide.id] }; }
  if (mutation.type === 'delete-slide') { const index = deck.slides.findIndex(s => s.id === mutation.slideId); if (index < 0) throw new Error('删除目标不存在'); deck.slides.splice(index, 1); return { affected: [mutation.slideId] }; }
  if (mutation.type === 'move-slide') { const from = deck.slides.findIndex(s => s.id === mutation.slideId); if (from < 0) throw new Error('移动目标不存在'); if (mutation.afterSlideId === mutation.slideId) throw new Error('不能移动到自身之后'); const [slide] = deck.slides.splice(from, 1); deck.slides.splice(insertIndex(deck.slides, mutation.afterSlideId), 0, slide); return { affected: [mutation.slideId] }; }
  const slide = findSlide(deck, mutation.slideId);
  if (mutation.type === 'update-slide') { Object.assign(slide, clone(mutation.changes)); return { affected: [slide.id] }; }
  if (mutation.type === 'add-element') { if (deck.slides.some(s => s.elements.some(e => e.id === mutation.element.id))) throw new Error('新增元素 ID 已存在'); slide.elements.push(clone(mutation.element)); return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } }; }
  const index = slide.elements.findIndex(e => e.id === (mutation.type === 'replace-element' ? mutation.element.id : mutation.elementId));
  if (mutation.type === 'replace-element') { if (index < 0) throw new Error('替换目标不存在'); slide.elements[index] = clone(mutation.element); return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.element.id } }; }
  if (index < 0) throw new Error('删除目标不存在'); slide.elements.splice(index, 1); slide.layoutId = fallbackLayout(slide); return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.elementId } };
}
export class DeckSession {
  current: Deck; private undoStack: DeckSnapshot[] = []; private redoStack: DeckSnapshot[] = [];
  constructor(initial: Deck, private readonly paper: Paper) { this.current = clone(initial); this.assertValid(this.current); }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; }
  private assertValid(deck: Deck) { const errors = validateDeck(deck, this.paper); if (errors.length) throw new Error(errors.join('；')); }
  commit(scope: RevisionScope, mutations: DeckMutation[], _summary: string) {
    const next = clone(this.current); for (const mutation of mutations) { const result = applyMutation(next, mutation); ensureScope(scope, result.affected, result.element); }
    this.assertValid(next); this.undoStack.push(snapshot(this.current)); if (this.undoStack.length > 20) this.undoStack.shift(); this.redoStack = [];
    next.revision = this.current.revision + 1; next.updatedAt = Date.now(); this.current = next; return clone(this.current);
  }
  undo() { if (!this.canUndo) return false; this.redoStack.push(snapshot(this.current)); const previous = this.undoStack.pop()!; this.current = { ...this.current, ...clone(previous), revision: this.current.revision + 1, updatedAt: Date.now() }; this.assertValid(this.current); return true; }
  redo() { if (!this.canRedo) return false; this.undoStack.push(snapshot(this.current)); const next = this.redoStack.pop()!; this.current = { ...this.current, ...clone(next), revision: this.current.revision + 1, updatedAt: Date.now() }; this.assertValid(this.current); return true; }
  reset(initial: Deck) { this.current = clone(initial); this.undoStack = []; this.redoStack = []; this.assertValid(this.current); }
}
export function createSlide(id: string, number: number): Slide { return { id, kind: 'custom' as SlideKind, title: '新幻灯片 ' + number, layoutId: 'text-only', elements: [{ id: id + '-text', type: 'text', text: '' }], claimIds: [], sourceIds: [] }; }
