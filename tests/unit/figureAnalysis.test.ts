import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fixturePaper, fixtureSource } from '../fixtures';
import { BBoxSchema } from '../../src/shared/schema';
import { DEFAULT_SETTINGS, ModelError, ModelOutputError, requestJson } from '../../src/shared/llm/model';
import { analyzeFigures } from '../../src/modules/paper/analysis';
import { FigurePageSchema, requestFigurePage } from '../../src/modules/paper/figurePage';
import type { PdfResource } from '../../src/shared/pdf/pdfResource';

vi.mock('../../src/shared/llm/model', async (original) => ({
  ...(await original<typeof import('../../src/shared/llm/model')>()),
  requestJson: vi.fn(),
}));

const pageResult = () => ({
  figures: [{ label: 'Figure 3', caption: '固定图注', description: '固定描述', bbox: fixtureSource.bbox, panels: [] }],
});
function invalidOutput() {
  const raw = { figures: [{ ...pageResult().figures[0], bbox: undefined }] };
  const parsed = FigurePageSchema.safeParse(raw);
  if (parsed.success) throw new Error('测试数据应缺失位置');
  return new ModelOutputError(
    'figures',
    raw,
    parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message })),
  );
}
const input = () => ({
  settings: DEFAULT_SETTINGS,
  context: { pageNumber: 8, pageText: 'Fig. 3: 固定图注', imageRegions: [] },
  image: 'data:image/png;base64,fixed-image',
  signal: new AbortController().signal,
});

describe('图页输出、有限修复与阶段原子性', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('发给模型的坐标约束包含范围；运行时仍拒绝右边界和下边界越界', () => {
    expect(z.toJSONSchema(BBoxSchema)).toMatchObject({
      properties: {
        x: { minimum: 0, exclusiveMaximum: 1 },
        y: { minimum: 0, exclusiveMaximum: 1 },
        width: { exclusiveMinimum: 0, maximum: 1 },
        height: { exclusiveMinimum: 0, maximum: 1 },
      },
      description: expect.stringContaining('x+width <= 1'),
    });
    expect(BBoxSchema.safeParse({ x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
    expect(BBoxSchema.safeParse({ x: 0.8, y: 0, width: 0.3, height: 1 }).success).toBe(false);
    expect(BBoxSchema.safeParse({ x: 0, y: 0.8, width: 1, height: 0.3 }).success).toBe(false);
  });

  it('缺少 bbox 时仅修复当前页，带回诊断、原图与原页上下文', async () => {
    const request = input();
    const failure = invalidOutput();
    vi.mocked(requestJson).mockRejectedValueOnce(failure).mockResolvedValueOnce(pageResult());
    expect(await requestFigurePage(request)).toEqual(pageResult());
    expect(requestJson).toHaveBeenCalledTimes(2);
    const repair = vi.mocked(requestJson).mock.calls[1];
    expect(repair[2]).toEqual({
      ...request.context,
      failedOutput: failure.failedOutput,
      diagnostics: failure.diagnostics,
    });
    expect(repair[3]).toBe(FigurePageSchema);
    expect(repair[4]).toBe(request.signal);
    expect(repair[5]).toBe('figures-repair');
    expect(repair[6]).toBe(request.image);
  });

  it('合法空页不发修复请求', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ figures: [] });
    expect(await requestFigurePage(input())).toEqual({ figures: [] });
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('两次失败给出页码和安全原因，原始模型内容不进入可见消息', async () => {
    const failure = invalidOutput();
    failure.diagnostics[0].message = 'private provider content';
    vi.mocked(requestJson).mockRejectedValue(failure);
    const error = await requestFigurePage(input()).catch((cause) => cause);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ stage: 'figures', code: 'invalid-figure-output', pageNumber: 8, cause: failure });
    expect(error.message).toContain('PDF 第 8 页');
    expect(error.message).toContain('位置缺失、格式不正确或超出页面范围');
    expect(error.message).not.toContain('private provider content');
  });

  it('缺少结构化结果与其他字段错误显示不同原因', async () => {
    const missing = new ModelOutputError('figures', null, [{ code: 'missing-result', path: '', message: 'raw' }]);
    vi.mocked(requestJson).mockRejectedValue(missing);
    await expect(requestFigurePage(input())).rejects.toThrow('模型未按要求返回图源分析结果');
    const malformed = new ModelOutputError('figures', null, [
      { code: 'invalid_type', path: 'figures', message: 'raw' },
    ]);
    vi.mocked(requestJson).mockRejectedValue(malformed);
    await expect(requestFigurePage(input())).rejects.toThrow('图源分析结果缺少必要信息或格式不正确');
  });

  it('网络和额度等请求错误不修复，修复时请求失败也保留原错误', async () => {
    const error = new ModelError('figures', 'quota', '额度不足');
    vi.mocked(requestJson).mockRejectedValueOnce(error);
    await expect(requestFigurePage(input())).rejects.toBe(error);
    expect(requestJson).toHaveBeenCalledTimes(1);
    vi.mocked(requestJson).mockReset().mockRejectedValueOnce(invalidOutput()).mockRejectedValueOnce(error);
    await expect(requestFigurePage(input())).rejects.toBe(error);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('取消优先于输出失败，不发额外请求', async () => {
    const controller = new AbortController();
    vi.mocked(requestJson).mockImplementationOnce(async () => {
      controller.abort();
      throw invalidOutput();
    });
    await expect(requestFigurePage({ ...input(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('后续页失败时不重跑前页，也不把工作副本写回原 Paper', async () => {
    const paper = structuredClone(fixturePaper);
    paper.pages = [1, 2].map((pageNumber) => ({ ...paper.pages[0], pageNumber, text: 'Fig. 3: 固定图注' }));
    const before = structuredClone(paper);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, toDataURL: () => input().image }) });
    const resource = { render: vi.fn(), imageRegions: vi.fn().mockResolvedValue([]) } as unknown as PdfResource;
    vi.mocked(requestJson).mockResolvedValueOnce(pageResult()).mockRejectedValue(invalidOutput());
    await expect(analyzeFigures(paper, resource, DEFAULT_SETTINGS, input().signal)).rejects.toMatchObject({
      pageNumber: 2,
    });
    expect(vi.mocked(requestJson).mock.calls.map((call) => (call[2] as { pageNumber: number }).pageNumber)).toEqual([
      1, 2, 2,
    ]);
    expect(paper).toEqual(before);
    expect(resource.render).toHaveBeenCalledTimes(2);
  });
});
