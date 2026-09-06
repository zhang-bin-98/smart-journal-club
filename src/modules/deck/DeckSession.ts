import { ApplyRevisionArgsSchema, type ApplyRevisionArgs, type Deck, type DeckMutation, type RevisionRecord, type RevisionRequest, type RevisionScope } from './deck.schema';
import type { Paper } from '../paper/paper.schema';
import { validateDeck } from './validateDeck';
import { applyMutation, ensureScope, findSlide } from './mutations';

export type DeckSnapshot = Pick<Deck, 'title' | 'language' | 'slides'>;
export type RevisionOptions = { signal?: AbortSignal; isTaskActive?: () => boolean };
export type PersistRevision = (previous: Deck, next: Deck, record: RevisionRecord, options?: RevisionOptions) => Promise<void>;
export type RevisionCommitOptions = RevisionOptions & { request?: RevisionRequest; persist?: PersistRevision };
const clone = <T>(value: T): T => structuredClone(value);
const snapshot = (deck: Deck): DeckSnapshot => clone({ title: deck.title, language: deck.language, slides: deck.slides });
export class DeckSession {
  current: Deck; private undoStack: DeckSnapshot[] = []; private redoStack: DeckSnapshot[] = [];
  private saving = false;
  private committedRequests = new Set<string>();
  constructor(initial: Deck, private readonly paper: Paper, private readonly persist?: PersistRevision, private readonly projectId = '') { this.current = clone(initial); this.assertValid(this.current); }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; }
  private assertValid(deck: Deck) { const errors = validateDeck(deck, this.paper); if (errors.length) throw new Error(errors.join('；')); }
  private async save(next: Deck, scope: RevisionScope, summary: string, affectedSlideIds: string[], requestId: string = crypto.randomUUID(), options?: RevisionCommitOptions) {
    if (this.saving) throw new Error('正在保存，请稍后重试');
    if (this.committedRequests.has(requestId)) throw new Error('本次修改已经提交');
    this.assertValid(next);
    next.revision = this.current.revision + 1; next.updatedAt = Date.now();
    options?.signal?.throwIfAborted();
    if (options?.isTaskActive && !options.isTaskActive()) throw new Error('修改请求已失效');
    if (options?.request && (options.request.requestId !== requestId || options.request.deckId !== next.id || options.request.baseRevision !== this.current.revision || (options.request.projectId && this.projectId && options.request.projectId !== this.projectId))) throw new Error('修改请求目标或版本已变化');
    const record: RevisionRecord = { id: requestId, projectId: this.projectId, deckId: next.id, baseRevision: this.current.revision, committedRevision: next.revision, scope, affectedSlideIds, summary, createdAt: next.updatedAt };
    this.saving = true;
    try { await (options?.persist ?? this.persist)?.(clone(this.current), clone(next), record, options); this.current = next; this.committedRequests.add(requestId); if (this.committedRequests.size > 100) this.committedRequests.delete(this.committedRequests.values().next().value!); }
    finally { this.saving = false; }
  }
  async commit(scope: RevisionScope, mutations: DeckMutation[], summary: string, requestId?: string, options?: RevisionCommitOptions): Promise<Deck> {
    const args = ApplyRevisionArgsSchema.parse({ scope, mutations, summary });
    scope = args.scope; mutations = args.mutations; summary = args.summary;
    if (scope.type === 'slides') {
      const known = new Set([...this.current.slides.map(slide => slide.id), ...mutations.flatMap(mutation => mutation.type === 'add-slide' ? [mutation.slide.id] : [])]);
      if (new Set(scope.slideIds).size !== scope.slideIds.length || scope.slideIds.some(id => !known.has(id))) throw new Error('修改范围含有重复或不存在的页');
      for (const mutation of mutations) {
        if ((mutation.type === 'add-slide' || mutation.type === 'move-slide') && mutation.afterSlideId !== null && !scope.slideIds.includes(mutation.afterSlideId)) throw new Error('插入位置超出请求范围');
      }
    } else if (scope.type === 'element') {
      if (!findSlide(this.current, scope.slideId).elements.some(element => element.id === scope.elementId)) throw new Error('修改元素不存在');
    }
    const previous = snapshot(this.current); const next = clone(this.current); const affected = new Set<string>();
    for (const mutation of mutations) {
      if (mutation.type === 'set-language' && scope.type !== 'deck') throw new Error('语言修改必须使用 deck 范围');
      const result = applyMutation(next, mutation); ensureScope(scope, result.affected, result.element); result.affected.forEach(id => affected.add(id));
    }
    await this.save(next, scope, summary, [...affected], requestId, options);
    this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift(); this.redoStack = [];
    return clone(this.current);
  }
  /** 应用已绑定目标与基准版本的 AI 修改候选；persist 由应用层组合提交时提供。 */
  applyRevision(request: RevisionRequest, args: ApplyRevisionArgs, options?: RevisionOptions & { persist?: PersistRevision }) {
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
