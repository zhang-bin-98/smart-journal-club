import type { BBox, Element, LayoutId, Slide } from './types';
export type Rect = BBox;
export type ComputedLayout = { title: Rect; message?: Rect; elements: { element: Element; rect: Rect }[] };
const r = (x:number,y:number,width:number,height:number):Rect => ({x,y,width,height});
export function computeLayout(slide: Slide): ComputedLayout {
  const title = r(.06,.06,.88,.1); const message = slide.message ? r(.06,.17,.88,.08) : undefined;
  const top = slide.message ? .28 : .22; const elements = slide.elements.map((element, i) => {
    if (slide.layoutId === 'title') return { element, rect: r(.08,.4,.84,.18) };
    if (slide.layoutId === 'figure-full') return { element, rect: r(.1,top,.8,.62) };
    if (slide.layoutId === 'figure-text') return { element, rect: element.type === 'figure' ? r(.06,top,.57,.62) : r(.68,top,.26,.62) };
    if (slide.layoutId === 'two-figures') return { element, rect: r(.06 + i * .47,top,.41,.62) };
    return { element, rect: r(.08,.3,.84,.5) };
  }); return { title, message, elements };
}
export function validateBBox(box: BBox) { return Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1; }
export function validateDeck(deck: { slides: Slide[] }) { const ids = new Set<string>(); const errors: string[] = []; deck.slides.forEach(s => { if (ids.has(s.id)) errors.push('重复 slide id'); ids.add(s.id); s.elements.forEach(e => { if (ids.has(e.id)) errors.push('重复 element id'); ids.add(e.id); }); }); return errors; }
