import { describe, expect, it } from 'vitest';
import { legacyDeckV1 } from '../legacy-fixtures';
import { fixtureDeck } from '../fixtures';
import { migrateDeckV1 } from '../../src/modules/deck/migrateDeck';
import { LegacyMigrationError, UnsupportedSchemaVersionError } from '../../src/shared/errors/migration';

const clone = <T>(value: T): T => structuredClone(value);

describe('Deck v1 → v2 迁移', () => {
  it('标准 v1 Deck 迁出连续 kind 段章节并补 sectionId', () => {
    const legacy = legacyDeckV1('legacy-deck');
    const deck = migrateDeckV1(clone(legacy));
    expect(deck.schemaVersion).toBe(2);
    expect(deck.sections.map((section) => section.kind)).toEqual(['opening', 'results', 'synthesis']);
    expect(deck.sections[0].id).toBe('legacy-deck-legacy-deck-slide-1-section');
    expect(deck.slides.map((slide) => slide.sectionId)).toEqual([
      deck.sections[0].id,
      deck.sections[1].id,
      deck.sections[1].id,
      deck.sections[2].id,
    ]);
  });

  it('不连续的 result 段生成两个不同 results 章节', () => {
    const legacy = legacyDeckV1('legacy-deck');
    legacy.slides = [legacy.slides[1], legacy.slides[3], { ...legacy.slides[1], id: 'late-result' }];
    const deck = migrateDeckV1(clone(legacy));
    expect(deck.sections.map((section) => section.kind)).toEqual(['results', 'synthesis', 'results']);
    expect(deck.sections[0].id === deck.sections[2].id).toBe(false);
  });

  it('迁移确定且幂等：重复迁移不产生新值', () => {
    const legacy = legacyDeckV1('legacy-deck');
    const first = migrateDeckV1(clone(legacy));
    const second = migrateDeckV1(clone(first));
    expect(second).toEqual(first);
    expect(migrateDeckV1(clone(legacy))).toEqual(first);
  });

  it('已是 v2 的输入原样返回', () => {
    expect(migrateDeckV1(clone(fixtureDeck))).toEqual(fixtureDeck);
  });

  it('页面/元素 ID、内容、裁图与版本时间保持不变', () => {
    const legacy = legacyDeckV1('legacy-deck');
    const deck = migrateDeckV1(clone(legacy));
    expect(deck.id).toBe(legacy.id);
    expect(deck.paperId).toBe(legacy.paperId);
    expect(deck.revision).toBe(legacy.revision);
    expect(deck.title).toBe(legacy.title);
    expect(deck.language).toBe(legacy.language);
    expect(deck.createdAt).toBe(legacy.createdAt);
    expect(deck.updatedAt).toBe(legacy.updatedAt);
    expect(deck.slides.map((slide) => slide.id)).toEqual(legacy.slides.map((slide) => slide.id));
    expect(deck.slides[1]).toEqual({
      ...legacy.slides[1],
      sectionId: deck.slides[1].sectionId,
    });
    const figure = deck.slides[1].elements[0];
    expect(figure.type === 'figure' ? figure.cropOverride : undefined).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.5,
    });
  });

  it('不猜测科学 purpose：迁移页保持无 purpose 字段，章节 purpose 为中性说明', () => {
    const deck = migrateDeckV1(legacyDeckV1('legacy-deck'));
    expect(deck.slides.every((slide) => !('purpose' in slide))).toBe(true);
    expect(deck.sections.every((section) => section.purpose.length > 0)).toBe(true);
  });

  it('零页 v1 Deck 迁为空 sections 与空 slides', () => {
    const legacy = { ...legacyDeckV1('legacy-deck'), slides: [] };
    const deck = migrateDeckV1(legacy);
    expect(deck.sections).toEqual([]);
    expect(deck.slides).toEqual([]);
  });

  it('未来版本拒绝且不迁移', () => {
    const future = { ...legacyDeckV1('legacy-deck'), schemaVersion: 3 };
    expect(() => migrateDeckV1(future)).toThrow(UnsupportedSchemaVersionError);
    expect(() => migrateDeckV1(future)).toThrow('不兼容');
  });

  it('损坏的 v1 数据（非法 kind / v2 字段混入）可恢复拒绝', () => {
    const broken = legacyDeckV1('legacy-deck');
    (broken.slides[0] as { kind: string }).kind = 'hypothesis';
    expect(() => migrateDeckV1(broken)).toThrow(LegacyMigrationError);
    const disguised = { ...legacyDeckV1('legacy-deck'), schemaVersion: 1, sections: [] };
    expect(() => migrateDeckV1(disguised)).toThrow(LegacyMigrationError);
  });
});
