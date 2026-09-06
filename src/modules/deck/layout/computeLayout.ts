import type { Element, Slide } from '../deck.schema';
import type { BBox } from '../../../shared/schema';

export type Rect = BBox;
export type TextMetrics = { fontSize: number; lineHeight: number; overflow: boolean };
export type ComputedLayout = {
  title: Rect;
  titleText: TextMetrics;
  message?: Rect;
  messageText: TextMetrics;
  sourceLabel: Rect;
  elements: { element: Element; rect: Rect; text: TextMetrics }[];
};
const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
let measurement: CanvasRenderingContext2D | null | undefined;
function textMetrics(value: string, rect: Rect, preferred: number, minimum: number, lineHeight = 1.3): TextMetrics {
  measurement ??= document.createElement('canvas').getContext('2d');
  const fits = (size: number) => {
    if (!measurement) return true;
    measurement.font = `${size}px Arial`;
    let lines = 1;
    let width = 0;
    for (const char of value) {
      const next = measurement.measureText(char).width;
      if (char === '\n' || width + next > rect.width * 960) {
        lines++;
        width = char === '\n' ? 0 : next;
      } else width += next;
    }
    return lines * size * lineHeight <= rect.height * 540;
  };
  let fontSize = preferred;
  while (fontSize > minimum && !fits(fontSize)) fontSize--;
  return { fontSize, lineHeight, overflow: !fits(fontSize) };
}
export function computeLayout(slide: Slide): ComputedLayout {
  const title = r(0.06, 0.05, 0.88, 0.14);
  const message = slide.message ? r(0.06, 0.205, 0.88, 0.065) : undefined;
  const top = slide.message ? 0.3 : 0.23;
  const figures = slide.elements.filter((element) => element.type === 'figure');
  const citations = slide.elements.filter((element) => element.type === 'citation');
  const content = slide.elements.filter((element) => element.type !== 'citation');
  const elements = content.map<{ element: Element; rect: Rect }>((element) => {
    if (slide.layoutId === 'title') return { element, rect: r(0.1, 0.38, 0.8, 0.2) };
    if (slide.layoutId === 'figure-full') return { element, rect: r(0.1, top, 0.8, 0.58) };
    if (slide.layoutId === 'figure-text') {
      if (element.type === 'figure') return { element, rect: r(0.06, top, 0.56, 0.57) };
      const auxiliary = content.filter((item) => item.type !== 'figure');
      const height = 0.57 / auxiliary.length;
      return { element, rect: r(0.68, top + auxiliary.indexOf(element) * height, 0.26, height - 0.025) };
    }
    if (slide.layoutId === 'two-figures') {
      const n = Math.max(
        0,
        figures.findIndex((candidate) => candidate.id === element.id),
      );
      return { element, rect: r(0.06 + n * 0.47, top, 0.41, 0.57) };
    }
    if (slide.layoutId === 'panel-grid') {
      const columns = figures.length > 2 ? 2 : Math.max(1, figures.length);
      const n = Math.max(
        0,
        figures.findIndex((candidate) => candidate.id === element.id),
      );
      return {
        element,
        rect: r(0.06 + (n % columns) * (0.88 / columns), top + Math.floor(n / columns) * 0.28, 0.82 / columns, 0.24),
      };
    }
    const height = Math.min(0.42, 0.52 / Math.max(1, content.length));
    return { element, rect: r(0.08, 0.3 + content.indexOf(element) * height, 0.84, height - 0.025) };
  });
  citations.forEach((element, index) => {
    elements.push({ element, rect: r(0.08, 0.84 + index * 0.035, 0.84, 0.028) });
  });
  return {
    title,
    titleText: textMetrics(slide.title, title, 26, 22, 1.2),
    message,
    messageText: textMetrics(slide.message ?? '', message ?? title, 12, 12),
    sourceLabel: r(0.06, 0.95, 0.88, 0.025),
    elements: elements.map((item) => ({
      ...item,
      text: textMetrics(
        item.element.type === 'text'
          ? item.element.text
          : item.element.type === 'bullet-list'
            ? item.element.items.join('\n')
            : '',
        item.rect,
        item.element.type === 'citation' ? 8 : 18,
        item.element.type === 'citation' ? 8 : 16,
      ),
    })),
  };
}
