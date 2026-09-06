import { z } from 'zod';
import { DeckSchema, FigureElementSchema, SlideSchema } from '../deck/deck.schema';

export const DeckPlanSchema = DeckSchema.pick({ schemaVersion: true, paperId: true, title: true, language: true }).extend({
  slides: z.array(SlideSchema.omit({ elements: true }).extend({ figures: z.array(FigureElementSchema.pick({ figureId: true, panelId: true })) })).min(1),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;
