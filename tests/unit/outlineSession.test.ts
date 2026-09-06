import { describe, expect, it, vi } from 'vitest';
import { OutlineSession } from '../../src/modules/outline/OutlineSession';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
const request = (plan: ReturnType<typeof narrativePlan>) => ({
  requestId: crypto.randomUUID(),
  projectId: 'project',
  planId: plan.id,
  baseRevision: plan.revision,
});

describe('OutlineSession', () => {
  it('预算与空章可保存草稿，确认时拒绝且不写入', async () => {
    const persist = vi.fn(async (_request, next) => next);
    const session = new OutlineSession(narrativePlan(), narrativePaper(), 'project', persist);
    await session.commit({
      ...session.capture(),
      mutations: [{ type: 'set-slide-budget', sectionId: 'n-sec-opening', slideBudget: 2 }],
    });
    expect(session.current.slides.length).toBe(narrativePlan().slides.length);
    await expect(session.confirm(session.capture())).rejects.toThrow('预算');
    expect(persist).toHaveBeenCalledTimes(1);
    await session.commit({
      ...session.capture(),
      mutations: [
        {
          type: 'add-section',
          section: { id: 'empty', title: '', purpose: '', kind: 'custom', slideBudget: 0 },
          afterSectionId: null,
        },
      ],
    });
    expect(session.current.sections[0].id).toBe('empty');
    const empty = new OutlineSession({ ...narrativePlan(), slides: [] }, narrativePaper(), 'project');
    await expect(empty.confirm(empty.capture())).rejects.toThrow('至少');
  });

  it('整批失败与持久化失败均保留内容、版本及撤销栈', async () => {
    const persist = vi.fn(async () => {
      throw new Error('存储失败');
    });
    const initial = narrativePlan();
    const session = new OutlineSession(initial, narrativePaper(), 'project', persist);
    await expect(
      session.commit({
        ...session.capture(),
        mutations: [
          { type: 'update-section', sectionId: 'n-sec-opening', patch: { title: '未提交' } },
          { type: 'delete-section', sectionId: 'n-sec-results' },
        ],
      }),
    ).rejects.toThrow('移动或删除');
    expect(persist).not.toHaveBeenCalled();
    await expect(
      session.commit({
        ...session.capture(),
        mutations: [{ type: 'set-slide-budget', sectionId: 'n-sec-opening', slideBudget: 2 }],
      }),
    ).rejects.toThrow('存储失败');
    expect(session.current).toEqual(initial);
    expect(session.canUndo).toBe(false);
  });

  it('警告必须确认，重复确认无写入，撤销不恢复生成授权', async () => {
    const plan = narrativePlan();
    plan.sections[0].transitionToNext = '';
    const session = new OutlineSession(plan, narrativePaper(), 'project');
    await expect(session.confirm(session.capture())).rejects.toThrow('警告');
    await session.confirm(session.capture(), { warningsAccepted: true });
    const confirmed = session.current;
    await session.confirm(session.capture());
    expect(session.current).toEqual(confirmed);
    await session.commit({
      ...session.capture(),
      mutations: [{ type: 'update-section', sectionId: 'n-sec-opening', patch: { title: '新章名' } }],
    });
    await session.undo();
    expect(session.current.status).toBe('draft');
    expect(session.current.revision).toBe(confirmed.revision + 2);
    expect(session.current.sections).toEqual(confirmed.sections);
    await session.redo();
    expect(session.current.sections[0].title).toBe('新章名');
    await session.undo();
    await session.commit({
      ...session.capture(),
      mutations: [{ type: 'set-slide-budget', sectionId: 'n-sec-opening', slideBudget: 2 }],
    });
    expect(session.canRedo).toBe(false);
  });

  it('拒绝旧目标、旧版本、重复请求与取消', async () => {
    const session = new OutlineSession(narrativePlan(), narrativePaper(), 'project');
    const captured = session.capture();
    const mutations = [{ type: 'set-slide-budget' as const, sectionId: 'n-sec-opening', slideBudget: 2 }];
    await expect(session.commit({ ...captured, projectId: 'other', mutations })).rejects.toThrow('目标或版本');
    const abort = new AbortController();
    abort.abort();
    await expect(session.commit({ ...captured, mutations }, { signal: abort.signal })).rejects.toThrow();
    await session.commit({ ...captured, mutations });
    await expect(session.commit({ ...captured, mutations })).rejects.toThrow('已经提交');
    await expect(session.commit({ ...captured, requestId: 'new', mutations })).rejects.toThrow('目标或版本');
  });

  it('章节移动携带页面块、移页不改预算且禁止跨章锚点', async () => {
    const session = new OutlineSession(narrativePlan(), narrativePaper(), 'project');
    const budgets = session.current.sections.map((section) => [section.id, section.slideBudget]);
    await session.commit({
      ...session.capture(),
      mutations: [{ type: 'move-section', sectionId: 'n-sec-results', afterSectionId: null }],
    });
    expect(session.current.slides[0].sectionId).toBe('n-sec-results');
    expect(session.current.sections.map((s) => [s.id, s.slideBudget]).sort()).toEqual(budgets.sort());
    await expect(
      session.commit({
        ...session.capture(),
        mutations: [
          {
            type: 'move-slide',
            slideId: 'n-slide-result-1',
            targetSectionId: 'n-sec-opening',
            afterSlideId: 'n-slide-result-2',
          },
        ],
      }),
    ).rejects.toThrow('目标章节');
    await session.commit({
      ...session.capture(),
      mutations: [
        { type: 'move-slide', slideId: 'n-slide-result-1', targetSectionId: 'n-sec-opening', afterSlideId: null },
      ],
    });
    expect(session.current.sections.find((s) => s.id === 'n-sec-opening')?.slideBudget).toBe(1);
  });
  it('编辑确认计划会回到 draft 并递增 revision', async () => {
    let plan = narrativePlan();
    plan = { ...plan, status: 'confirmed', confirmedAt: 1 };
    const session = new OutlineSession(plan, narrativePaper(), 'project');
    const next = await session.commit({
      ...request(plan),
      mutations: [{ type: 'update-section', sectionId: 'n-sec-opening', patch: { title: '编辑后' } }],
    });
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
