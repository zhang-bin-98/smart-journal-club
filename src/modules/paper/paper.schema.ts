import { MetadataSchema } from './document';
import { ClaimSchema, EvidenceSchema, StorySchema, StudyProfileSchema } from './evidence';

export { MetadataSchema } from './document';
export {
  type Claim,
  ClaimSchema,
  type Evidence,
  EvidenceSchema,
  StoryPointSchema,
  StorySchema,
  StoryTopics,
  StudyProfileSchema,
} from './evidence';

import { z } from 'zod';
import { BBoxSchema } from '../../shared/schema';

export const SourceReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['text', 'figure', 'panel', 'caption']),
  pageNumber: z.number().int().positive(),
  bbox: BBoxSchema.optional(),
  textQuote: z.string().optional(),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export const FigurePanelSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  sourceId: z.string().min(1),
  description: z.string().optional(),
});
export type FigurePanel = z.infer<typeof FigurePanelSchema>;
export const FigureRefSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  caption: z.string().optional(),
  sourceId: z.string().min(1),
  description: z.string().optional(),
  panels: z.array(FigurePanelSchema),
});
export type FigureRef = z.infer<typeof FigureRefSchema>;
export const PaperSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  metadata: MetadataSchema,
  pages: z.array(
    z.strictObject({
      pageNumber: z.number().int().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      text: z.string(),
    }),
  ),
  sources: z.array(SourceReferenceSchema),
  figures: z.array(FigureRefSchema),
  studyProfile: StudyProfileSchema.optional(),
  story: StorySchema.optional(),
  claims: z.array(ClaimSchema),
  evidences: z.array(EvidenceSchema),
});
export type Paper = z.infer<typeof PaperSchema>;
