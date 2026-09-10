import { beforeEach, describe, expect, it, vi } from 'vitest';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
import {
  assignPlanIds,
  normalizePlanningContent,
  planDeck,
  PlanningContentSchema,
} from '../../src/modules/generation/planDeck';
import { DEFAULT_SETTINGS, ModelError, ModelOutputError, requestJson } from '../../src/app/model';

vi.mock('../../src/app/model', async (original) => ({
  ...(await original<typeof import('../../src/app/model')>()),
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
    expect(call[0].stage).toBe('plan-repair');
    expect(call[0].data).toMatchObject({ failedOutput: raw, diagnostics: [{ code: 'invalid-plan' }] });
    expect(call[0].systemPrompt).toContain('不要改写叙事质量');
  });

  it('唯一 Figure/Panel 展示标签映射回内部 ID，并纠正确定的布局容量', () => {
    const paper = narrativePaper();
    const raw = content();
    const result = raw.slides.find((slide) => slide.figures.length)!;
    const figure = paper.figures[0];
    result.figures = [{ figureId: 'Figure 3', panelId: 'Panel A' }];
    result.layoutId = 'panel-grid';
    const normalized = normalizePlanningContent(raw, paper);
    const normalizedResult = normalized.slides.find((slide) => slide.id === result.id)!;
    expect(normalizedResult.figures).toEqual([{ figureId: figure.id, panelId: figure.panels[0].id }]);
    expect(normalizedResult.layoutId).toBe('figure-text');
  });

  it('中文 Figure 展示标签也可映射到唯一英文标签', () => {
    const paper = narrativePaper();
    const raw = content();
    raw.slides.find((slide) => slide.figures.length)!.figures = [{ figureId: '图 3' }];
    expect(assignPlanIds(raw, paper).slides.find((slide) => slide.figures.length)!.figures[0].figureId).toBe(
      paper.figures[0].id,
    );
  });

  it('展示标签有歧义时不猜测 Figure 引用', () => {
    const paper = narrativePaper();
    paper.figures.push({ ...structuredClone(paper.figures[0]), id: 'duplicate-figure' });
    const raw = content();
    raw.slides.find((slide) => slide.figures.length)!.figures = [{ figureId: 'Figure 3' }];
    expect(() => assignPlanIds(raw, paper)).toThrow('汇报计划无效');
  });

  it('schema 失败保留诊断且第二次失败不循环', async () => {
    const failure = new ModelOutputError('plan', { slides: null }, [
      { code: 'invalid_type', path: 'slides', message: '须为数组' },
    ]);
    vi.mocked(requestJson).mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestJson).mock.calls[1][0].data).toMatchObject({
      failedOutput: failure.failedOutput,
      diagnostics: failure.diagnostics,
    });
  });

  it('repair 返回的结构仍无效时隐藏底层长串并返回阶段错误', async () => {
    const raw = content();
    raw.slides[0].sectionId = 'missing';
    vi.mocked(requestJson).mockResolvedValue(raw);
    await expect(run()).rejects.toMatchObject({
      stage: 'plan-repair',
      code: 'invalid-output',
      message: '模型输出不符合本阶段数据要求，最近保存的成果仍保留，请重试。',
    });
    expect(requestJson).toHaveBeenCalledTimes(2);
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
