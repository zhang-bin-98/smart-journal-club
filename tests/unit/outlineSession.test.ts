import { describe, expect, it } from 'vitest';
import { OutlineSession } from '../../src/modules/outline/OutlineSession';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
const request = (plan: ReturnType<typeof narrativePlan>) => ({ requestId: crypto.randomUUID(), projectId: 'project', planId: plan.id, baseRevision: plan.revision });

describe('OutlineSession', () => {
  it('编辑确认计划会回到 draft 并递增 revision', async () => {
    let plan = narrativePlan();
    plan = { ...plan, status: 'confirmed', confirmedAt: 1 };
    const session = new OutlineSession(plan, narrativePaper(), 'project');
    const next = await session.commit({ ...request(plan), mutations: [{ type: 'update-section', sectionId: 'n-sec-opening', patch: { title: '编辑后' } }] });
    expect(next.status).toBe('draft');
    expect('confirmedAt' in next).toBe(false);
    expect(next.revision).toBe(plan.revision + 1);
  });

  it('确认存在叙事错误的计划会拒绝', async () => {
    const plan = narrativePlan();
    plan.slides.find((slide) => slide.kind === 'result')!.claimIds = [];
    const session = new OutlineSession(plan, narrativePaper(), 'project');
    await expect(session.confirm(request(plan))).rejects.toThrow('计划无法确认');
  });
});
