import { z } from 'zod';
import { DeckSchemaVersion, DeckSectionSchema, SlideSchema } from '../deck/deck.schema';

export const PlannedSectionSchema = DeckSectionSchema.extend({
  slideBudget: z.number().int().nonnegative(),
});
export type PlannedSection = z.infer<typeof PlannedSectionSchema>;
export const PlannedFigureSchema = z.strictObject({
  figureId: z.string().min(1),
  panelId: z.string().min(1).optional(),
});
export type PlannedFigure = z.infer<typeof PlannedFigureSchema>;
export const PlannedSlideSchema = SlideSchema.omit({ elements: true }).extend({
  purpose: z.string(),
  message: z.string(),
  figures: z.array(PlannedFigureSchema),
});
export type PlannedSlide = z.infer<typeof PlannedSlideSchema>;
// claimEmphasis 是稀疏覆盖：没有 entry 的 Claim 缺省为 brief，层级只有 focus / omit。
export const ClaimEmphasises = ['focus', 'omit'] as const;
export type ClaimEmphasis = (typeof ClaimEmphasises)[number];
export const ClaimEmphasisEntrySchema = z.strictObject({
  claimId: z.string().min(1),
  emphasis: z.enum(ClaimEmphasises),
});
export type ClaimEmphasisEntry = z.infer<typeof ClaimEmphasisEntrySchema>;
export const DeckPlanStatuses = ['draft', 'confirmed'] as const;
export type DeckPlanStatus = (typeof DeckPlanStatuses)[number];

const DeckPlanShape = {
  schemaVersion: z.literal(DeckSchemaVersion),
  id: z.string().min(1),
  paperId: z.string().min(1),
  title: z.string(),
  language: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sections: z.array(PlannedSectionSchema),
  slides: z.array(PlannedSlideSchema),
  claimEmphasis: z.array(ClaimEmphasisEntrySchema),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};
export const DeckPlanSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...DeckPlanShape, status: z.literal('draft') }),
  z.strictObject({ ...DeckPlanShape, status: z.literal('confirmed'), confirmedAt: z.number().int().nonnegative() }),
]);
export type DeckPlan = z.infer<typeof DeckPlanSchema>;

export const PlanRecordSchema = z.strictObject({
  recordVersion: z.literal(1),
  projectId: z.string().min(1),
  mode: z.enum(['initial', 'regeneration']),
  plan: DeckPlanSchema,
  base: z
    .strictObject({
      currentDeckId: z.string().min(1).optional(),
      currentRevision: z.number().int().nonnegative().optional(),
    })
    .optional(),
  preferences: z.record(z.string(), z.unknown()),
  updatedAt: z.number().int().nonnegative(),
});
export type PlanRecord = z.infer<typeof PlanRecordSchema>;
