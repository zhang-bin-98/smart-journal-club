import { z } from 'zod';
import { GenerationBaseSchema, PreferencesSchema, type Project } from '../../modules/project/model';
import type { Paper } from '../../modules/paper/model';
import { SpeechPlanSchema } from '../../modules/presentation/planning';
import { ContentError } from '../../modules/presentation/content';
export const PlanRecordSchema = z.strictObject({
  recordVersion: z.literal(2),
  projectId: z.string().min(1),
  stage: z.literal('outline-ready'),
  plan: SpeechPlanSchema,
  generationPreferences: PreferencesSchema,
  mode: z.enum(['initial', 'regeneration']),
  base: GenerationBaseSchema,
});
export type PlanRecord = z.infer<typeof PlanRecordSchema>;
export type GenerationBase = z.infer<typeof GenerationBaseSchema>;
export function preferencesKey(input: z.infer<typeof PreferencesSchema>) {
  const value = PreferencesSchema.parse(input);
  return JSON.stringify([
    value.instruction,
    value.language ?? null,
    value.targetSlides ?? null,
    value.strategyId ?? null,
  ]);
}
export function assertGenerationBase(
  base: GenerationBase,
  project: Project,
  paper: Paper,
  current?: { id: string; revision: number },
  previous?: { id: string; revision: number },
) {
  if (
    paper.projectId !== project.id ||
    project.paperId !== base.paperId ||
    paper.id !== base.paperId ||
    paper.revision !== base.paperRevision ||
    paper.figureReview.revision !== base.figureReviewRevision ||
    paper.figureReview.confirmedRevision !== base.figureReviewRevision ||
    preferencesKey(project.preferences) !== preferencesKey(base.projectPreferences) ||
    project.currentDeckId !== base.current?.deckId ||
    project.previousDeckId !== base.previous?.deckId ||
    current?.revision !== base.current?.revision ||
    previous?.revision !== base.previous?.revision
  )
    throw new ContentError('stale-base', '论文、切分、项目偏好或当前稿已变化，请重新生成讲稿。');
}
