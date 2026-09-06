import { describe, expect, it } from 'vitest';
import { legacyDeckPlanV1, legacyCreatedAt, legacyUpdatedAt } from '../legacy-fixtures';
import { migratePlanV1 } from '../../src/modules/outline/migrateDeckPlan';
import { LegacyMigrationError, UnsupportedSchemaVersionError } from '../../src/shared/errors/migration';

const clone = <T>(value: T): T => structuredClone(value);
const context = { projectId: 'legacy-project', projectCreatedAt: legacyCreatedAt, projectUpdatedAt: legacyUpdatedAt };

describe('DeckPlan v1 → v2 迁移', () => {
  it('标准 v1 计划迁移为 draft：ID、时间与状态均来自确定性来源', () => {
    const plan = migratePlanV1(legacyDeckPlanV1(), context);
    expect(plan.schemaVersion).toBe(2);
    expect(plan.status).toBe('draft');
    expect(plan.revision).toBe(0);
    expect(plan.claimEmphasis).toEqual([]);
    expect(plan.id).toBe('plan-legacy-project');
    expect(plan.createdAt).toBe(legacyCreatedAt);
    expect(plan.updatedAt).toBe(legacyUpdatedAt);
    expect((plan as { confirmedAt?: number }).confirmedAt).toBeUndefined();
  });

  it('按连续 kind 段生成章节，预算等于实际页数', () => {
    const legacy = legacyDeckPlanV1();
    legacy.slides.push({ ...legacy.slides[1], id: 'second-result' });
    const plan = migratePlanV1(clone(legacy), context);
    expect(plan.sections.map((section) => section.kind)).toEqual(['opening', 'results']);
    expect(plan.sections.map((section) => section.slideBudget)).toEqual([1, 2]);
    expect(plan.slides.map((slide) => slide.sectionId)).toEqual([
      plan.sections[0].id,
      plan.sections[1].id,
      plan.sections[1].id,
    ]);
  });

  it('旧 message 保留、缺失补空，purpose 使用中性页职责', () => {
    const plan = migratePlanV1(legacyDeckPlanV1(), context);
    expect(plan.slides[0].message).toBe('');
    expect(plan.slides[0].purpose).toBe('开场标题页');
    expect(plan.slides[1].message).toBe('旧 message 保留');
    expect(plan.slides[1].purpose).toBe('呈现一项结果');
    expect(plan.slides[1].figures).toEqual([{ figureId: 'fig-3' }]);
    expect(plan.slides[1].claimIds).toEqual(['claim-fixture']);
  });

  it('确定且幂等：重复迁移结果稳定', () => {
    const first = migratePlanV1(legacyDeckPlanV1(), context);
    expect(migratePlanV1(clone(first), context)).toEqual(first);
    expect(migratePlanV1(legacyDeckPlanV1(), context)).toEqual(first);
  });

  it('未来版本拒绝；损坏或零页 v1 计划明确失败', () => {
    expect(() => migratePlanV1({ ...legacyDeckPlanV1(), schemaVersion: 3 }, context)).toThrow(
      UnsupportedSchemaVersionError,
    );
    const broken = legacyDeckPlanV1();
    (broken.slides[0] as { layoutId: string }).layoutId = 'hologram';
    expect(() => migratePlanV1(broken, context)).toThrow(LegacyMigrationError);
    expect(() => migratePlanV1({ ...legacyDeckPlanV1(), slides: [] }, context)).toThrow(LegacyMigrationError);
  });
});
