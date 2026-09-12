import pptxgen from 'pptxgenjs';
import { notesText } from '../../modules/presentation/content';
import { computeLayout } from '../../modules/presentation/layout/computeLayout';
import { validateDeck } from '../../modules/deck/validateDeck';
import type { Deck, Element } from '../../modules/deck/deck.schema';
import type { Paper as LegacyPaper } from '../../modules/paper/paper.schema';
import type { Paper as CurrentPaper } from '../../modules/paper/model';
import { imageAspect } from '../../modules/presentation/layout/figureGeometry';
type Paper = LegacyPaper | CurrentPaper;
import { figureSource, sourceIdsExcludingPages, sourceText } from '../../modules/paper/sources';
export async function exportDeck(
  deck: Deck,
  paper: Paper,
  getImage: (element: Extract<Element, { type: 'figure' }>) => Promise<string>,
  signal?: AbortSignal,
) {
  if (!deck.slides.length) throw new Error('空 Deck 不能导出');
  const errors = validateDeck(deck, paper);
  if (errors.length) throw new Error(errors.join('；'));
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'smartJC';
  pptx.title = deck.title;
  for (const slide of deck.slides) {
    signal?.throwIfAborted();
    const out = pptx.addSlide();
    if (slide.speechIds?.length) out.addNotes(notesText(deck.speech ?? [], slide.speechIds));
    const aspects = Object.fromEntries(
      slide.elements
        .filter((element) => element.type === 'figure')
        .map((element) => [element.id, imageAspect(paper, element)]),
    );
    const layout = computeLayout(slide, aspects);
    const box = (rect: { x: number; y: number; width: number; height: number }) => ({
      x: rect.x * 13.333,
      y: rect.y * 7.5,
      w: rect.width * 13.333,
      h: rect.height * 7.5,
      margin: 0,
      fontFace: 'Arial',
      color: '203040',
    });
    out.addText(slide.title, {
      ...box(layout.title),
      fontSize: layout.titleText.fontSize,
      lineSpacingMultiple: layout.titleText.lineHeight,
      bold: true,
    });
    if (layout.message)
      out.addText(slide.message ?? '', {
        ...box(layout.message),
        fontSize: layout.messageText.fontSize,
        lineSpacingMultiple: layout.messageText.lineHeight,
        color: '526575',
      });
    const sourceIds = new Set(slide.sourceIds);
    const citationSourceIds = new Set<string>();
    for (const { element, rect, text } of layout.elements) {
      const opts = { ...box(rect), fontSize: text.fontSize, lineSpacingMultiple: text.lineHeight };
      if (element.type === 'figure') {
        let data: string;
        try {
          data = await getImage(element);
        } catch {
          throw new Error(`第 ${deck.slides.indexOf(slide) + 1} 页图源缺失，导出已停止`);
        }
        signal?.throwIfAborted();
        out.addImage({ data, x: opts.x, y: opts.y, w: opts.w, h: opts.h });
        sourceIds.add(figureSource(paper, element).id);
      } else if (element.type === 'text') out.addText(element.text, { ...opts, breakLine: false });
      else if (element.type === 'bullet-list')
        out.addText(
          element.items.map((item) => ({ text: item, options: { bullet: { indent: 12 }, breakLine: true } })),
          opts,
        );
      else {
        element.sourceIds.forEach((id) => {
          citationSourceIds.add(id);
        });
        out.addText(sourceText(paper, element.sourceIds), { ...opts, fontSize: 8, color: '526575' });
      }
    }
    const footerText = sourceText(paper, sourceIdsExcludingPages(paper, [...sourceIds], [...citationSourceIds]));
    if (footerText) out.addText(footerText, { ...box(layout.sourceLabel), fontSize: 8, color: '526575' });
  }
  signal?.throwIfAborted();
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  signal?.throwIfAborted();
  return blob;
}

export function downloadDeck(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[<>:"/\\|?*]/g, '-') || 'smartJC'}.pptx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
