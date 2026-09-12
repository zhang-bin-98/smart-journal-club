import { z } from 'zod';
import { ContentSchema } from '../content';
import { LayoutIds, SlideKinds } from '../content/page';
import { BBoxSchema } from '../../../shared/schema';
import { FigureGroupSchema } from '../layout';
export const PlannedFigureSchema = z.strictObject({
  id: z.string().min(1),
  figureId: z.string().min(1),
  regionId: z.string().optional(),
  panelId: z.string().optional(),
  cropOverride: BBoxSchema.optional(),
});
export const PlannedSlideSchema = z.strictObject({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  kind: z.enum(SlideKinds),
  title: z.string(),
  purpose: z.string(),
  message: z.string(),
  layoutId: z.enum(LayoutIds),
  figureGroup: FigureGroupSchema.optional(),
  speechIds: z.array(z.string()),
  claimIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
  figures: z.array(PlannedFigureSchema).max(4),
});
export type PlannedSlide = z.infer<typeof PlannedSlideSchema>;
export const SpeechPlanSchema = ContentSchema.extend({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  paperId: z.string().min(1),
  paperRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['draft', 'ready']),
  slides: z.array(PlannedSlideSchema),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SpeechPlan = z.infer<typeof SpeechPlanSchema>;
