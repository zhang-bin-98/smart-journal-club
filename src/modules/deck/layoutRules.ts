import type { Slide } from './deck.schema';

export const layoutRules = {
  title: '无图，最多一个副标题 text 元素',
  'text-only': '无图，最多四个 text / bullet-list 元素',
  'figure-full': '一个 figure，无正文元素',
  'figure-text': '一个 figure，最多两个短 text / bullet-list 元素',
  'two-figures': '两个 figure，无正文元素',
  'panel-grid': '三个或四个 figure，无正文元素',
};
/** 布局容量只依赖布局与元素构成；计划侧用仅含 figure 的元素集合同样适用。 */
export function layoutCapacity(slide: Pick<Slide, 'layoutId' | 'elements'>) {
  const figures = slide.elements.filter((element) => element.type === 'figure').length;
  const content = slide.elements.filter((element) => element.type !== 'citation').length;
  if (slide.layoutId === 'title') return figures === 0 && content <= 1;
  if (slide.layoutId === 'text-only') return figures === 0 && content <= 4;
  if (slide.layoutId === 'figure-full') return figures === 1 && content === 1;
  if (slide.layoutId === 'figure-text') return figures === 1 && content >= 1 && content <= 3;
  if (slide.layoutId === 'two-figures') return figures === 2 && content === 2;
  return figures >= 3 && figures <= 4 && content === figures;
}
