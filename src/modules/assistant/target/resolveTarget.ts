import type { Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';

export type AiRecentMessage = { role: string; text: string; deckId?: string; baseRevision?: number; revision?: number; targetSlideIds?: string[]; targetElementId?: string };
export type AiTarget = { slideIds: string[]; global: boolean; elementId?: string; figureId?: string; titleOnly?: boolean; allowNewSlides: boolean; clarification?: string };
// 保留其他内容的限制不应被识别为另一项修改或整轮只读要求。
export function modificationRequest(request: string) {
  return request.replace(/(?:其他|其余)[^，。；\n]*(?:保持|不变|不要|不改|不修改)[^，。；\n]*/g, '')
    .replace(/(?:不要|不需|不用|不)(?:修改|改动|改|动)(?:其他|其余)[^，。；\n]*/g, '');
}
const numberPattern = '[0-9零一二两三四五六七八九十百]+';
function pageNumber(text: string) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0; let value = 0;
  for (const char of text) { if (char === '十' || char === '百') { total += (value || 1) * (char === '十' ? 10 : 100); value = 0; } else value = digits[char] ?? 0; }
  return total + value;
}
function explicitPages(request: string) {
  const pages: number[] = [];
  for (const match of request.matchAll(new RegExp(`第\\s*(${numberPattern})(?:\\s*[-—–到至]\\s*(${numberPattern}))?\\s*页|(?:slide|page)\\s*(\\d+)`, 'gi'))) {
    const first = pageNumber(match[1] ?? match[3]); const last = match[2] ? pageNumber(match[2]) : first;
    if (last < first || last - first > 100) return [0];
    for (let page = first; page <= last; page++) pages.push(page);
  }
  const list = request.match(new RegExp(`第\\s*(${numberPattern}(?:\\s*[、,，和及]\\s*${numberPattern})+)\\s*页`));
  if (list) for (const value of list[1].matchAll(new RegExp(numberPattern, 'g'))) pages.push(pageNumber(value[0]));
  const leading = request.match(new RegExp(`前\\s*(${numberPattern})\\s*页`));
  if (leading) { const count = pageNumber(leading[1]); if (count > 100) return [0]; for (let page = 1; page <= count; page++) pages.push(page); }
  return [...new Set(pages)];
}
export function resolveSlideTarget(request: string, deck: Deck, selectedSlideId?: string) {
  const pages = explicitPages(request);
  return pages.length ? deck.slides[pages[0] - 1]?.id : deck.slides.find(slide => slide.id === selectedSlideId)?.id ?? deck.slides[0]?.id;
}
export function resolveAiTarget(request: string, deck: Deck, paper: Paper, selectedSlideId?: string, selectedElementId?: string, recentMessages: AiRecentMessage[] = []): AiTarget {
  const pages = explicitPages(request);
  const global = !pages.length && /整体|全部|所有|整套|全局|每一页|全篇|entire deck|all slides/i.test(request);
  const target: AiTarget = { slideIds: [], global, allowNewSlides: global || /新增|添加|插入|拆|分成|压成|合并|太挤|压到|增加.*页/.test(request) };
  if (!deck.slides.length && /这(?:一)?页|当前页|本页|这张图/.test(request)) return { ...target, clarification: '当前文稿没有幻灯片，请先新增页面或明确要创建的内容。' };
  if (pages.some(page => !deck.slides[page - 1])) return { ...target, clarification: '指定页码超出当前幻灯片范围，请提供有效页码。' };
  if (pages.length) target.slideIds = pages.map(page => deck.slides[page - 1].id);
  else if (global) target.slideIds = deck.slides.map(slide => slide.id);
  else if (/这(?:一)?页|当前页|本页/.test(request)) target.slideIds = [resolveSlideTarget(request, deck, selectedSlideId)].filter((id): id is string => !!id);
  else {
    const sections = [{ pattern: /背景/, kinds: ['background'] }, { pattern: /研究问题/, kinds: ['question'] }, { pattern: /方法/, kinds: ['method'] }, { pattern: /结果部分|结果页/, kinds: ['result'] }, { pattern: /讨论部分|讨论页/, kinds: ['discussion'] }, { pattern: /结论部分|结论页/, kinds: ['conclusion'] }];
    const section = sections.find(item => item.pattern.test(request));
    if (section) {
      target.slideIds = deck.slides.filter(slide => section.kinds.includes(slide.kind)).map(slide => slide.id);
      if (!target.slideIds.length) return { ...target, clarification: '当前文稿中没有找到指定部分，请提供要调整的页码。' };
    }
  }
  const figureMatch = request.match(/(?:Figure|Fig\.?|图)\s*(\d+)/i);
  if (figureMatch) {
    const figures = paper.figures.filter(figure => (figure.label?.match(/\d+/)?.[0] === figureMatch[1]));
    if (figures.length !== 1) return { ...target, clarification: '无法唯一定位这个 Figure，请提供原论文图号及所在幻灯片页码。' };
    target.figureId = figures[0].id;
    let occurrences = deck.slides.filter(slide => slide.elements.some(element => element.type === 'figure' && element.figureId === target.figureId));
    if (target.slideIds.length) occurrences = occurrences.filter(slide => target.slideIds.includes(slide.id));
    else {
      const selected = occurrences.find(slide => slide.id === selectedSlideId);
      if (selected) occurrences = [selected];
      else {
        const previous = [...recentMessages].reverse().find(message => message.targetSlideIds?.length && (!message.deckId || message.deckId === deck.id));
        const recent = occurrences.filter(slide => previous?.targetSlideIds?.includes(slide.id));
        if (recent.length === 1) occurrences = recent;
      }
    }
    if (!occurrences.length) return { ...target, clarification: '指定范围中没有这个 Figure，请提供它所在的幻灯片页码。' };
    if (!target.slideIds.length && occurrences.length > 1) return { ...target, clarification: `这个 Figure 出现在第 ${occurrences.map(slide => deck.slides.indexOf(slide) + 1).join('、')} 页，请指定要调整哪一处。` };
    target.slideIds = occurrences.map(slide => slide.id);
  }
  if (!target.slideIds.length && selectedSlideId && deck.slides.some(slide => slide.id === selectedSlideId)) target.slideIds = [selectedSlideId];
  if (!target.slideIds.length) {
    const previous = [...recentMessages].reverse().find(message => message.targetSlideIds?.some(id => deck.slides.some(slide => slide.id === id)) && (!message.deckId || message.deckId === deck.id));
    target.slideIds = previous?.targetSlideIds?.filter(id => deck.slides.some(slide => slide.id === id)) ?? (deck.slides[0] ? [deck.slides[0].id] : []);
  }
  const changes = modificationRequest(request);
  target.titleOnly = /标题|title/i.test(changes) && !/正文|内容|布局|图|拆|新增|添加/.test(changes);
  const selectedSlide = deck.slides.find(slide => slide.id === selectedSlideId && target.slideIds.includes(slide.id));
  if (!target.titleOnly && !target.figureId && !pages.length && !global && !/这(?:一)?页|当前页|本页|背景|研究问题|方法|结果页/.test(request)) {
    if (selectedSlide?.elements.some(element => element.id === selectedElementId)) target.elementId = selectedElementId;
    else if (!selectedSlideId) {
      const previous = [...recentMessages].reverse().find(message => message.targetElementId && message.targetSlideIds?.some(id => target.slideIds.includes(id)));
      if (deck.slides.some(slide => target.slideIds.includes(slide.id) && slide.elements.some(element => element.id === previous?.targetElementId))) target.elementId = previous?.targetElementId;
    }
  }
  return target;
}
