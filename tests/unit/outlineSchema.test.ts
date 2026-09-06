import { describe, expect, it } from 'vitest';
import { fixturePaper } from '../fixtures';
import { DeckPlanSchema } from '../../src/modules/outline/outline.schema';

const base = {
  schemaVersion: 2,
  id: 'plan',
  paperId: fixturePaper.id,
  title: '契约测试计划',
  language: 'zh-CN',
  status: 'draft',
  revision: 0,
  sections: [{ id: 'sec-1', kind: 'opening', title: '开场', purpose: '', slideBudget: 1 }],
  slides: [
    {
      id: 'p1',
      sectionId: 'sec-1',
      kind: 'title',
      title: '标题页',
      purpose: '',
      message: '',
      layoutId: 'title',
      claimIds: [] as string[],
      sourceIds: [] as string[],
      figures: [],
    },
  ],
  claimEmphasis: [] as unknown[],
  createdAt: 0,
  updatedAt: 0,
};
const attempt = (overrides: Record<string, unknown> = {}) => DeckPlanSchema.safeParse({ ...base, ...overrides });

describe('DeckPlan v2 形状契约', () => {
  it('合法 draft 通过，草稿允许零页', () => {
    const draft = attempt();
    expect(draft.success && draft.data.status).toBe('draft');
    const empty = attempt({ slides: [] });
    expect(empty.success && empty.data.slides).toEqual([]);
  });

  it('confirmed 必须携带 confirmedAt，draft 不得包含该字段', () => {
    expect(attempt({ status: 'confirmed', confirmedAt: 1 }).success).toBe(true);
    expect(attempt({ status: 'confirmed' }).success).toBe(false);
    expect(attempt({ confirmedAt: 1 }).success).toBe(false);
  });

  it('非法章节 kind、缺 slideBudget、缺 sectionId 均拒绝', () => {
    expect(
      attempt({ sections: [{ id: 's', kind: 'hypothesis', title: '', purpose: '', slideBudget: 1 }] }).success,
    ).toBe(false);
    expect(attempt({ sections: [{ id: 's', kind: 'custom', title: '', purpose: '' }] }).success).toBe(false);
    expect(attempt({ slides: [{ ...base.slides[0], sectionId: undefined }] }).success).toBe(false);
  });

  it('claimEmphasis 只接受 focus/omit，未知字段拒绝', () => {
    expect(attempt({ claimEmphasis: [{ claimId: 'claim-fixture', emphasis: 'major' }] }).success).toBe(false);
    expect(attempt({ claimEmphasis: [{ claimId: 'claim-fixture', emphasis: 'omit' }] }).success).toBe(true);
    expect(attempt({ slideBudgetTotal: 5 }).success).toBe(false);
  });
});
