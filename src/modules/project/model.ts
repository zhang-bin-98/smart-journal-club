import { z } from 'zod';

export const WorkspaceSteps = ['paper-analysis', 'figure-review', 'outline-speech', 'slides'] as const;
export const PreferencesSchema = z.strictObject({
  instruction: z.string(),
  language: z.string().optional(),
  targetSlides: z.number().int().positive().optional(),
  strategyId: z.string().optional(),
});
export const GenerationBaseSchema = z.strictObject({
  projectPreferences: PreferencesSchema,
  paperId: z.string().min(1),
  paperRevision: z.number().int().nonnegative(),
  figureReviewRevision: z.number().int().nonnegative(),
  current: z.strictObject({ deckId: z.string(), revision: z.number().int().nonnegative() }).optional(),
  previous: z.strictObject({ deckId: z.string(), revision: z.number().int().nonnegative() }).optional(),
});
export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  name: z.string().trim().min(1),
  nameIsCustom: z.boolean().optional(),
  paperId: z.string().min(1),
  currentDeckId: z.string().optional(),
  previousDeckId: z.string().optional(),
  candidate: z
    .strictObject({
      deckId: z.string(),
      generatedFrom: z.strictObject({ planId: z.string(), planRevision: z.number().int().nonnegative() }),
      generationPreferences: PreferencesSchema,
      base: GenerationBaseSchema,
    })
    .optional(),
  checkpoint: z.enum([
    'project-created',
    'pdf-parsed',
    'figures-ready',
    'paper-ready',
    'outline-ready',
    'deck-plan-ready',
    'deck-ready',
  ]),
  preferences: PreferencesSchema,
  lastOpenedSlideId: z.string().optional(),
  lastOpenedStep: z.enum(WorkspaceSteps).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type WorkspaceStep = (typeof WorkspaceSteps)[number];
export type PdfAsset = { blob: Blob; name: string };

export class ProjectError extends Error {
  readonly stage = 'project';
  readonly recovery = '保留现有成果并重新打开项目后重试。';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
