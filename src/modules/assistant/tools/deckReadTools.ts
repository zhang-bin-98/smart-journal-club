import { z } from 'zod';
import type { Deck } from '../../deck/deck.schema';

export const deckReadSchemas = {
  'deck.get': z.strictObject({ slideIds: z.array(z.string().min(1)).min(1).optional() }),
};
export const deckReadDescriptions: Record<keyof typeof deckReadSchemas, string> = {
  'deck.get': '按稳定 Slide ID 读取必要页面；不传 slideIds 时只返回当前文稿目录。',
};
export function deckReadTool(args: unknown, deck: Deck) {
  const parsed = deckReadSchemas['deck.get'].parse(args);
  const ids = (parsed as { slideIds?: string[] }).slideIds;
  if (ids?.some(id => !deck.slides.some(slide => slide.id === id))) throw new Error('幻灯片不存在');
  return { id: deck.id, revision: deck.revision, title: deck.title, language: deck.language, slides: ids ? deck.slides.filter(slide => ids.includes(slide.id)) : deck.slides.map(({ id, title, kind }, index) => ({ id, title, kind, pageNumber: index + 1 })) };
}
