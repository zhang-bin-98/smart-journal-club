import { z } from 'zod';
import type { Deck } from '../../deck/deck.schema';
import { AssistantError } from '../assistantError';

export const deckReadSchemas = {
  outline_get_structure: z.strictObject({}),
  deck_get_slides: z.strictObject({
    slideIds: z.array(z.string().min(1)).min(1).optional(),
    sectionId: z.string().min(1).optional(),
  }),
};
export const deckReadLabels = { outline_get_structure: '读取当前章节', deck_get_slides: '读取幻灯片' };
export const deckReadDescriptions = {
  outline_get_structure: '读取当前文稿的最终章节、页职责和 Take-home。',
  deck_get_slides: '按稳定 Slide ID 或 Section ID 读取页面；不传时只返回目录。',
};
export function deckReadTool(name: keyof typeof deckReadSchemas, args: unknown, deck: Deck) {
  const parsed = deckReadSchemas[name].parse(args);
  const directory = deck.slides.map(({ id, title, kind, sectionId, purpose, message }, index) => ({
    id,
    title,
    kind,
    sectionId,
    purpose,
    message,
    pageNumber: index + 1,
  }));
  if (name === 'outline_get_structure') return { sections: deck.sections, slides: directory };
  const { slideIds, sectionId } = parsed as { slideIds?: string[]; sectionId?: string };
  if (
    slideIds?.some((id) => !deck.slides.some((slide) => slide.id === id)) ||
    (sectionId && !deck.sections.some((section) => section.id === sectionId))
  )
    throw new AssistantError('unknown-target', '章节或幻灯片不存在');
  return {
    id: deck.id,
    revision: deck.revision,
    title: deck.title,
    language: deck.language,
    slides:
      slideIds || sectionId
        ? deck.slides.filter(
            (slide) => (!slideIds || slideIds.includes(slide.id)) && (!sectionId || slide.sectionId === sectionId),
          )
        : directory,
  };
}
