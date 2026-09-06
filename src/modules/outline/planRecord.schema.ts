import { z } from 'zod';
import { ProjectSchema } from '../project/project.schema';
import { DeckPlanSchema } from './outline.schema';

const DeckPointerSchema = z.strictObject({
  deckId: z.string().min(1),
  revision: z.number().int().nonnegative(),
});
export const GenerationBaseSchema = z.strictObject({
  current: DeckPointerSchema,
  previous: DeckPointerSchema.optional(),
});
export type GenerationBase = z.infer<typeof GenerationBaseSchema>;
const recordShape = {
  recordVersion: z.literal(1),
  projectId: z.string().min(1),
  plan: DeckPlanSchema,
  preferences: ProjectSchema.shape.preferences,
};
export const PlanRecordSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...recordShape, mode: z.literal('initial') }),
  z.strictObject({ ...recordShape, mode: z.literal('regeneration'), base: GenerationBaseSchema }),
]);
export type PlanRecord = z.infer<typeof PlanRecordSchema>;
