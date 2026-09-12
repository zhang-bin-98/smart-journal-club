import { z } from 'zod';
import { ContentSchema } from '../content';
export const SpeechPlanSchema = ContentSchema.extend({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  paperId: z.string().min(1),
  paperRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['draft', 'ready']),
  slides: z.array(z.never()),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SpeechPlan = z.infer<typeof SpeechPlanSchema>;
