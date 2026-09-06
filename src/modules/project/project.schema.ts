import { z } from 'zod';

export const Checkpoints = ['project-created', 'pdf-parsed', 'figures-ready', 'paper-ready', 'deck-plan-ready', 'deck-ready'] as const;
export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), nameIsCustom: z.boolean().optional(), paperId: z.string().min(1), pdfAssetId: z.string().min(1),
  currentDeckId: z.string().optional(), previousDeckId: z.string().optional(), checkpoint: z.enum(Checkpoints),
  preferences: z.strictObject({ instruction: z.string(), language: z.string().optional(), targetSlides: z.number().int().positive().optional(), strategyId: z.string().optional() }),
  lastOpenedSlideId: z.string().optional(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type PdfAsset = { blob: Blob; name: string };
