import { z } from 'zod';
import { DeckPlanSchema, PlannedFigureSchema, type DeckPlan, type PlannedSection } from './outline.schema';
import { SlideSchema } from '../deck/deck.schema';
import { LegacySlidePurposes, legacySectionOf, legacySectionRuns, schemaVersionOf } from '../deck/migrateDeck';
import { LegacyMigrationError, UnsupportedSchemaVersionError } from '../../shared/errors/migration';

// v1 计划形状逐字段恢复自 M9.1 之前的 outline.schema.ts：无 id/status/revision/sections/claimEmphasis/时间字段。
export const LegacyDeckPlanV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  paperId: z.string().min(1),
  title: z.string(),
  language: z.string().min(1),
  slides: z
    .array(
      SlideSchema.omit({ elements: true, sectionId: true, purpose: true }).extend({
        figures: z.array(PlannedFigureSchema),
      }),
    )
    .min(1),
});
export type LegacyDeckPlanV1 = z.infer<typeof LegacyDeckPlanV1Schema>;

export type PlanMigrationContext = {
  projectId: string;
  projectCreatedAt: number;
  projectUpdatedAt: number;
};

/** v1 计划确定性迁移为 v2 draft：不视为已确认、不推导 emphasis，ID 与时间取自项目记录，不用当前时间。 */
export function migratePlanV1(raw: unknown, context: PlanMigrationContext): DeckPlan {
  const parsed = DeckPlanSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const version = schemaVersionOf(raw);
  if (version === undefined || version > 2)
    throw new UnsupportedSchemaVersionError('汇报计划数据版本与当前应用不兼容，请更新应用后重试；项目数据已保留。');
  const legacy = LegacyDeckPlanV1Schema.safeParse(raw);
  if (!legacy.success) throw new LegacyMigrationError('旧汇报计划无法安全迁移，可返回上一步重新规划。');
  const planId = `plan-${context.projectId}`;
  const runs = legacySectionRuns(planId, legacy.data.slides);
  const sectionIds = new Map(runs.flatMap((run) => run.slideIds.map((slideId) => [slideId, run.sectionId])));
  const sections: PlannedSection[] = runs.map((run) => ({
    ...legacySectionOf(run),
    slideBudget: run.slideIds.length,
  }));
  const plan: DeckPlan = {
    schemaVersion: 2,
    id: planId,
    paperId: legacy.data.paperId,
    title: legacy.data.title,
    language: legacy.data.language,
    status: 'draft',
    revision: 0,
    sections,
    slides: legacy.data.slides.map((slide) => ({
      ...slide,
      sectionId: sectionIds.get(slide.id)!,
      purpose: LegacySlidePurposes[slide.kind],
      message: slide.message ?? '',
    })),
    claimEmphasis: [],
    createdAt: context.projectCreatedAt,
    updatedAt: context.projectUpdatedAt,
  };
  const result = DeckPlanSchema.safeParse(plan);
  if (!result.success) throw new LegacyMigrationError('旧汇报计划无法安全迁移，可返回上一步重新规划。');
  return result.data;
}
