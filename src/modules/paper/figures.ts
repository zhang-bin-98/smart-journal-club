import { z } from 'zod';
import { SourceReferenceSchema } from './document';

const identity = z.string().min(1);
const pageNumber = z.number().int().positive();
export const FigurePanelSchema = z.strictObject({
  id: identity,
  label: z.string().optional(),
  sourceId: identity,
  description: z.string().optional(),
  labelOrigin: z.enum(['automatic', 'manual']).optional(),
  captionAssociation: z
    .strictObject({
      links: z.array(z.strictObject({ sourceId: identity, role: z.enum(['panel', 'shared']) })),
      origin: z.enum(['automatic', 'manual']),
      status: z.enum(['linked', 'needs-review']),
    })
    .optional(),
});
export const FigureRefSchema = z.strictObject({
  id: identity,
  label: z.string().optional(),
  caption: z.string().optional(),
  captionSourceIds: z.array(identity).optional(),
  description: z.string().optional(),
  regions: z.array(z.strictObject({ id: identity, sourceId: identity, panels: z.array(FigurePanelSchema) })).min(1),
});
export const FigurePageSelectionSchema = z.strictObject({
  documentId: identity,
  pageNumber,
  automatic: z.enum(['pending', 'detected', 'not-detected']),
  manualOverride: z.enum(['include', 'exclude']).optional(),
  revision: z.number().int().positive(),
  processedRevision: z.number().int().positive().optional(),
});
export const FigureReviewSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  confirmedRevision: z.number().int().nonnegative().optional(),
  confirmedAt: z.number().int().nonnegative().optional(),
  automaticBaseline: z
    .strictObject({ figures: z.array(FigureRefSchema), sources: z.array(SourceReferenceSchema) })
    .optional(),
});
export type FigureRef = z.infer<typeof FigureRefSchema>;
export type FigurePanel = z.infer<typeof FigurePanelSchema>;
export type FigurePageSelection = z.infer<typeof FigurePageSelectionSchema>;
