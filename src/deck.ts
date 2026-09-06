import { layoutCapacity, validateDeck } from './layout';
import { ApplyRevisionArgsSchema, type ApplyRevisionArgs, type Deck, type Element, type Paper, type Slide, type SlideKind, type RevisionScope, type DeckMutation } from './types';
export type { ApplyRevisionArgs, RevisionScope, DeckMutation } from './types';
export type DeckSnapshot = Pick<Deck, 'title' | 'language' | 'slides'>;
export type RevisionRecord = { id: string; projectId: string; deckId: string; baseRevision: number; committedRevision: number; scope: RevisionScope; affectedSlideIds: string[]; summary: string; createdAt: number };
export type PersistRevision = (previous: Deck, next: Deck, record: RevisionRecord, options?: { signal?: AbortSignal; isTaskActive?: () => boolean }) => Promise<void>;
export type RevisionRequest = { requestId: string; projectId: string; deckId: string; baseRevision: number };
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
  if (!layoutCapacity(slide)) { slide.layoutId = fallbackLayout(slide); return { affected: [slide.id] }; }
  return { affected: [slide.id], element: { slideId: slide.id, elementId: mutation.elementId } };
}
export class DeckSession {
  current: Deck; private undoStack: DeckSnapshot[] = []; private redoStack: DeckSnapshot[] = [];
  private saving = false;
  constructor(initial: Deck, private readonly paper: Paper, private readonly persist?: PersistRevision, private readonly projectId = '') { this.current = clone(initial); this.assertValid(this.current); }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; }
  private assertValid(deck: Deck) { const errors = validateDeck(deck, this.paper); if (errors.length) throw new Error(errors.join('；')); }
  private async save(next: Deck, scope: RevisionScope, summary: string, affectedSlideIds: string[], requestId: string = crypto.randomUUID(), options?: { signal?: AbortSignal; isTaskActive?: () => boolean; request?: RevisionRequest }) {
    if (this.saving) throw new Error('正在保存，请稍后重试');
    this.assertValid(next);
    next.revision = this.current.revision + 1; next.updatedAt = Date.now();
    options?.signal?.throwIfAborted();
    if (options?.isTaskActive && !options.isTaskActive()) throw new Error('修改请求已失效');
    if (options?.request && (options.request.requestId !== requestId || options.request.deckId !== next.id || options.request.baseRevision !== this.current.revision || (options.request.projectId && this.projectId && options.request.projectId !== this.projectId))) throw new Error('修改请求目标或版本已变化');
    const record: RevisionRecord = { id: requestId, projectId: this.projectId, deckId: next.id, baseRevision: this.current.revision, committedRevision: next.revision, scope, affectedSlideIds, summary, createdAt: next.updatedAt };
    this.saving = true;
    try { await this.persist?.(clone(this.current), clone(next), record, options); this.current = next; }
    finally { this.saving = false; }
  }
  async commit(scope: RevisionScope, mutations: DeckMutation[], summary: string, requestId?: string, options?: { signal?: AbortSignal; isTaskActive?: () => boolean; request?: RevisionRequest }): Promise<Deck> {
    const args = ApplyRevisionArgsSchema.parse({ scope, mutations, summary });
    scope = args.scope; mutations = args.mutations; summary = args.summary;
    const effectiveRequestId = requestId;
    const effectiveOptions = options;
    const previous = snapshot(this.current); const next = clone(this.current); const affected = new Set<string>();
    for (const mutation of mutations) {
      if (mutation.type === 'set-language' && scope.type !== 'deck') throw new Error('语言修改必须使用 deck 范围');
      const result = applyMutation(next, mutation); ensureScope(scope, result.affected, result.element); result.affected.forEach(id => affected.add(id));
    }
    await this.save(next, scope, summary, [...affected], effectiveRequestId, effectiveOptions);
    this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift(); this.redoStack = [];
    return clone(this.current);
  }
  /** 应用已绑定目标与基准版本的 AI 修改候选。 */
  applyRevision(request: RevisionRequest, args: ApplyRevisionArgs, options?: { signal?: AbortSignal; isTaskActive?: () => boolean }) {
    return this.commit(args.scope, args.mutations, args.summary, request.requestId, { ...options, request });
  }
  async undo() {
    if (!this.canUndo) return false;
    const current = snapshot(this.current); const previous = this.undoStack.at(-1)!;
    await this.save({ ...this.current, ...clone(previous) }, { type: 'deck' }, '撤销修改', previous.slides.map(slide => slide.id));
    this.undoStack.pop(); this.redoStack.push(current); if (this.redoStack.length > 20) this.redoStack.shift(); return true;
  }
  async redo() {
    if (!this.canRedo) return false;
    const current = snapshot(this.current); const next = this.redoStack.at(-1)!;
    await this.save({ ...this.current, ...clone(next) }, { type: 'deck' }, '重做修改', next.slides.map(slide => slide.id));
    this.redoStack.pop(); this.undoStack.push(current); if (this.undoStack.length > 20) this.undoStack.shift(); return true;
  }
  reset(initial: Deck) { this.current = clone(initial); this.undoStack = []; this.redoStack = []; this.assertValid(this.current); }
}
export function createSlide(id: string, number: number): Slide { return { id, kind: 'custom' as SlideKind, title: '新幻灯片 ' + number, layoutId: 'text-only', elements: [{ id: id + '-text', type: 'text', text: '' }], claimIds: [], sourceIds: [] }; }
