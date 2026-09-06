import { beforeEach, describe, expect, it, vi } from 'vitest';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
import { assignPlanIds, planDeck, PlanningContentSchema } from '../../src/modules/generation/planDeck';
import { DEFAULT_SETTINGS, ModelError, ModelOutputError, requestJson } from '../../src/shared/llm/model';

vi.mock('../../src/shared/llm/model', async (original) => ({
  ...(await original<typeof import('../../src/shared/llm/model')>()),
  requestJson: vi.fn(),
}));
const content = () => {
  const { title, language, sections, slides, claimEmphasis } = narrativePlan();
  return { title, language, sections, slides, claimEmphasis };
};
const run = (signal = new AbortController().signal) =>
  planDeck(narrativePaper(), { instruction: '', strategyId: 'general' }, DEFAULT_SETTINGS, signal);

describe('规划内容与一次修复', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
  });

  it('模型不能指定封套；应用重映射章节和页面 ID 并创建 draft', () => {
    expect(PlanningContentSchema.safeParse({ ...content(), status: 'confirmed' }).success).toBe(false);
    const raw = content();
    const plan = assignPlanIds(raw, narrativePaper());
    expect(plan.status).toBe('draft');
    expect(plan.revision).toBe(0);
    expect(plan.paperId).toBe(narrativePaper().id);
    expect(plan.createdAt).toBe(plan.updatedAt);
    expect(plan.createdAt).toBeGreaterThan(0);
    expect(plan.sections[0].id).not.toBe(raw.sections[0].id);
    expect(plan.slides[0].id).not.toBe(raw.slides[0].id);
    expect(plan.slides[0].sectionId).toBe(plan.sections[0].id);
    expect(plan.id).not.toBe(assignPlanIds(raw, narrativePaper()).id);
  });

  it('引用失败向唯一 repair 传递原结果和诊断', async () => {
    const raw = content();
    raw.slides[0].sectionId = 'missing';
    vi.mocked(requestJson).mockResolvedValueOnce(raw).mockResolvedValueOnce(content());
    expect((await run()).status).toBe('draft');
    expect(requestJson).toHaveBeenCalledTimes(2);
    const call = vi.mocked(requestJson).mock.calls[1];
    expect(call[5]).toBe('plan-repair');
    expect(call[2]).toMatchObject({ failedOutput: raw, diagnostics: [{ code: 'invalid-plan' }] });
    expect(call[1]).toContain('不要改写叙事质量');
  });

  it('schema 失败保留诊断且第二次失败不循环', async () => {
    const failure = new ModelOutputError('plan', { slides: null }, [
      { code: 'invalid_type', path: 'slides', message: '须为数组' },
    ]);
    vi.mocked(requestJson).mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestJson).mock.calls[1][2]).toMatchObject({
      failedOutput: failure.failedOutput,
      diagnostics: failure.diagnostics,
    });
  });

  it.each(['authentication', 'rate-limit', 'timeout', 'model-request', 'truncated'])(
    '请求错误 %s 不触发 repair',
    async (code) => {
      const error = new ModelError('plan', code, '请求失败');
      vi.mocked(requestJson).mockRejectedValue(error);
      await expect(run()).rejects.toBe(error);
      expect(requestJson).toHaveBeenCalledTimes(1);
    },
  );

  it('取消和未知实现错误不触发 repair', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(requestJson).mockRejectedValue(new ModelOutputError('plan', null, []));
    await expect(run(controller.signal)).rejects.toThrow();
    expect(requestJson).toHaveBeenCalledTimes(1);
    vi.mocked(requestJson).mockReset().mockRejectedValue(new Error('实现错误'));
    await expect(run()).rejects.toThrow('实现错误');
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('叙事与预算问题保留为 draft，不自动改写', async () => {
    const raw = content();
    raw.slides.find((slide) => slide.kind === 'result')!.message = '';
    raw.sections[0].slideBudget = 99;
    vi.mocked(requestJson).mockResolvedValue(raw);
    const plan = await run();
    expect(plan.sections[0].slideBudget).toBe(99);
    expect(plan.slides.find((slide) => slide.kind === 'result')!.message).toBe('');
    expect(requestJson).toHaveBeenCalledTimes(1);
  });
});
