import type { Paper as CurrentPaper } from '../../paper/model';
import type { Paper as LegacyPaper } from '../../paper/paper.schema';
type Paper = CurrentPaper | LegacyPaper;
import type { FigureElementSchema, Slide } from '../content/page';
import type { z } from 'zod';
import { figureSource } from '../../paper/sources';

export function imageAspect(paper: Paper, figure: z.infer<typeof FigureElementSchema>) {
  const source = figureSource(paper, figure);
  const bbox = figure.cropOverride ?? source.bbox!;
  const page = paper.pages.find(
    (item) =>
      (!('documentId' in source) || ('documentId' in item && item.documentId === source.documentId)) &&
      item.pageNumber === source.pageNumber,
  );
  if (!page) throw new Error('图源原页不存在。');
  return (page.width * bbox.width) / (page.height * bbox.height);
}
export function figureArea(slide: Pick<Slide, 'layoutId' | 'message'>) {
  return {
    x: slide.layoutId === 'figure-full' ? 0.1 : 0.06,
    y: slide.message ? 0.3 : 0.23,
    width: slide.layoutId === 'figure-text' ? 0.56 : slide.layoutId === 'figure-full' ? 0.8 : 0.88,
    height: 0.57,
  };
}
