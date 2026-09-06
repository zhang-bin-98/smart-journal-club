import { describe, expect, it } from 'vitest';
import { OutlineSession } from '../../src/modules/outline/OutlineSession';
import { narrativePaper, narrativePlan } from '../narrative-fixture';

describe('OutlineSession', () => {
  it('编辑确认计划会回到 draft 并递增 revision', () => {
    let plan = narrativePlan();
    plan = { ...plan, status: 'confirmed', confirmedAt: 1 };
    const session = new OutlineSession(plan, narrativePaper());
    const next = session.commit((draft) => {
      draft.title = '编辑后';
    });
    expect(next.status).toBe('draft');
    expect('confirmedAt' in next).toBe(false);
    expect(next.revision).toBe(plan.revision + 1);
  });

  it('确认存在叙事错误的计划会拒绝', () => {
    const plan = narrativePlan();
    plan.slides.find((slide) => slide.kind === 'result')!.claimIds = [];
    const session = new OutlineSession(plan, narrativePaper());
    expect(() => session.confirm()).toThrow('计划无法确认');
  });
});
