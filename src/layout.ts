import { DeckSchema, LayoutIds, type BBox, type Element, type LayoutId, type Paper, type Slide } from './types';
import { figureSource, validatePaper } from './sources';
export type Rect = BBox;
export type ComputedLayout = { title: Rect; message?: Rect; sourceLabel: Rect; elements: { element: Element; rect: Rect }[] };
const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
export function computeLayout(slide: Slide): ComputedLayout {
  const title = r(.06, .055, .88, .085); const message = slide.message ? r(.06, .15, .88, .075) : undefined;
  const top = slide.message ? .28 : .22; const figures = slide.elements.filter(element => element.type === 'figure'); const citations = slide.elements.filter(element => element.type === 'citation');
  const content = slide.elements.filter(element => element.type !== 'citation');
  const elements = content.map<{ element: Element; rect: Rect }>((element) => {
    if (slide.layoutId === 'title') return { element, rect: r(.1, .38, .8, .2) };
    if (slide.layoutId === 'figure-full') return { element, rect: r(.1, top, .8, .58) };
    if (slide.layoutId === 'figure-text') { if (element.type === 'figure') return { element, rect: r(.06, top, .56, .57) }; return { element, rect: r(.68, top + Math.min(2, content.indexOf(element)) * .13, .26, .1) }; }
    if (slide.layoutId === 'two-figures') { const n = Math.max(0, figures.findIndex(candidate => candidate.id === element.id)); return { element, rect: r(.06 + n * .47, top, .41, .57) }; }
    if (slide.layoutId === 'panel-grid') { const columns = figures.length > 2 ? 2 : Math.max(1, figures.length); const n = Math.max(0, figures.findIndex(candidate => candidate.id === element.id)); return { element, rect: r(.06 + (n % columns) * (.88 / columns), top + Math.floor(n / columns) * .28, .82 / columns, .24) }; }
    const height = Math.min(.42, .52 / Math.max(1, content.length)); return { element, rect: r(.08, .3 + content.indexOf(element) * height, .84, height - .025) };
  });
  citations.forEach((element, index) => elements.push({ element, rect: r(.08, .84 + index * .035, .84, .028) }));
  return { title, message, sourceLabel: r(.06, .95, .88, .025), elements };
}
export function validateBBox(box: BBox) { return Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1; }
export function layoutCapacity(slide: Slide) {
  const figures = slide.elements.filter(element => element.type === 'figure').length; const content = slide.elements.filter(element => element.type !== 'citation').length;
  if (slide.layoutId === 'title') return figures === 0 && content <= 1;
  if (slide.layoutId === 'text-only') return figures === 0 && content <= 4;
  if (slide.layoutId === 'figure-full') return figures === 1 && content === 1;
  if (slide.layoutId === 'figure-text') return figures === 1 && content >= 1 && content <= 3;
  if (slide.layoutId === 'two-figures') return figures === 2 && content === 2;
  return figures >= 3 && figures <= 4 && content === figures;
}
export function validateDeck(input: unknown, paper?: Paper) {
  const parsed = DeckSchema.safeParse(input); if (!parsed.success) return parsed.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message);
  const deck = parsed.data; const ids = new Set<string>(); const errors: string[] = [];
  if (paper) { try { validatePaper(paper); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
  if (paper && deck.paperId !== paper.id) errors.push('Deck 不属于当前 Paper');
  deck.slides.forEach(slide => {
    if (ids.has(slide.id)) errors.push('重复 slide id'); ids.add(slide.id);
    if (!layoutCapacity(slide)) errors.push('布局无法容纳当前元素：' + slide.id);
    slide.elements.forEach(element => {
      if (ids.has(element.id)) errors.push('重复 element id'); ids.add(element.id);
      if (paper && element.type === 'figure') { try { figureSource(paper, element); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
      if (paper && element.type === 'citation' && element.sourceIds.some(id => !paper.sources.some(source => source.id === id))) errors.push('来源不存在：' + element.id);
    });
    if (paper && slide.sourceIds.some(id => !paper.sources.some(source => source.id === id))) errors.push('页来源不存在：' + slide.id);
    if (paper && slide.claimIds.some(id => !paper.claims.some(claim => claim.id === id))) errors.push('页结论不存在：' + slide.id);
  });
  return errors;
}
export function layoutIds(): readonly LayoutId[] { return LayoutIds; }
