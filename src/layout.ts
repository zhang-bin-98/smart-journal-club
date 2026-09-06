import { DeckPlanSchema, DeckSchema, LayoutIds, type BBox, type Deck, type DeckPlan, type Element, type LayoutId, type Paper, type Slide } from './types';
import { figureSource, validatePaper } from './sources';
export type Rect = BBox;
export type TextMetrics = { fontSize: number; lineHeight: number; overflow: boolean };
export type ComputedLayout = { title: Rect; titleText: TextMetrics; message?: Rect; messageText: TextMetrics; sourceLabel: Rect; elements: { element: Element; rect: Rect; text: TextMetrics }[] };
const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
let measurement: CanvasRenderingContext2D | null | undefined;
function textMetrics(value: string, rect: Rect, preferred: number, minimum: number, lineHeight = 1.3): TextMetrics {
  measurement ??= document.createElement('canvas').getContext('2d');
  const fits = (size: number) => {
    if (!measurement) return true;
    measurement.font = `${size}px Arial`;
    let lines = 1; let width = 0;
    for (const char of value) {
      const next = measurement.measureText(char).width;
      if (char === '\n' || width + next > rect.width * 960) { lines++; width = char === '\n' ? 0 : next; }
      else width += next;
    }
    return lines * size * lineHeight <= rect.height * 540;
  };
  let fontSize = preferred;
  while (fontSize > minimum && !fits(fontSize)) fontSize--;
  return { fontSize, lineHeight, overflow: !fits(fontSize) };
}
export function computeLayout(slide: Slide): ComputedLayout {
  const title = r(.06, .05, .88, .14); const message = slide.message ? r(.06, .205, .88, .065) : undefined;
  const top = slide.message ? .30 : .23; const figures = slide.elements.filter(element => element.type === 'figure'); const citations = slide.elements.filter(element => element.type === 'citation');
  const content = slide.elements.filter(element => element.type !== 'citation');
  const elements = content.map<{ element: Element; rect: Rect }>((element) => {
    if (slide.layoutId === 'title') return { element, rect: r(.1, .38, .8, .2) };
    if (slide.layoutId === 'figure-full') return { element, rect: r(.1, top, .8, .58) };
    if (slide.layoutId === 'figure-text') {
      if (element.type === 'figure') return { element, rect: r(.06, top, .56, .57) };
      const auxiliary = content.filter(item => item.type !== 'figure'); const height = .57 / auxiliary.length;
      return { element, rect: r(.68, top + auxiliary.indexOf(element) * height, .26, height - .025) };
    }
    if (slide.layoutId === 'two-figures') { const n = Math.max(0, figures.findIndex(candidate => candidate.id === element.id)); return { element, rect: r(.06 + n * .47, top, .41, .57) }; }
    if (slide.layoutId === 'panel-grid') { const columns = figures.length > 2 ? 2 : Math.max(1, figures.length); const n = Math.max(0, figures.findIndex(candidate => candidate.id === element.id)); return { element, rect: r(.06 + (n % columns) * (.88 / columns), top + Math.floor(n / columns) * .28, .82 / columns, .24) }; }
    const height = Math.min(.42, .52 / Math.max(1, content.length)); return { element, rect: r(.08, .3 + content.indexOf(element) * height, .84, height - .025) };
  });
  citations.forEach((element, index) => elements.push({ element, rect: r(.08, .84 + index * .035, .84, .028) }));
  return { title, titleText: textMetrics(slide.title, title, 26, 22, 1.2), message, messageText: textMetrics(slide.message ?? '', message ?? title, 12, 12), sourceLabel: r(.06, .95, .88, .025),
    elements: elements.map(item => ({ ...item, text: textMetrics(item.element.type === 'text' ? item.element.text : item.element.type === 'bullet-list' ? item.element.items.join('\n') : '', item.rect, item.element.type === 'citation' ? 8 : 18, item.element.type === 'citation' ? 8 : 16) })),
  };
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
export function validatePlan(input: unknown, paper: Paper): DeckPlan {
  const plan = DeckPlanSchema.parse(input);
  const candidate: Deck = { ...plan, id: 'plan-validation', revision: 0, createdAt: 0, updatedAt: 0,
    slides: plan.slides.map(({ figures, ...slide }) => ({ ...slide, elements: figures.map(figure => ({ ...figure, id: crypto.randomUUID(), type: 'figure' as const })) })),
  };
  const errors = validateDeck(candidate, paper);
  if (errors.length) throw new Error('汇报计划无效：' + errors.join('；'));
  return plan;
}
