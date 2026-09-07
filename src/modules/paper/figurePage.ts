import { z } from 'zod';
import { BBoxSchema } from '../../shared/schema';
import { ModelError, ModelOutputError, requestJson, type ModelSettings } from '../../shared/llm/model';
import { prompts } from '../../shared/llm/prompts';
import type { PdfResource } from '../../shared/pdf/pdfResource';

export const FigurePageSchema = z.strictObject({
  figures: z.array(
    z.strictObject({
      label: z.string().min(1),
      caption: z.string(),
      description: z.string(),
      bbox: BBoxSchema,
      panels: z.array(
        z.strictObject({
          label: z.string().min(1),
          description: z.string(),
          bbox: BBoxSchema.describe(
            '必填：此 Panel 在完整 PDF 页中的 x/y/width/height 归一化矩形；x+width <= 1 且 y+height <= 1。无法确定坐标则不返回该 Panel。',
          ),
        }),
      ),
    }),
  ),
});

function outputProblem(error: ModelOutputError) {
  if (error.diagnostics.some((issue) => issue.path.split('.').includes('bbox')))
    return '图或子图的位置缺失、格式不正确或超出页面范围';
  if (error.diagnostics.some((issue) => issue.code === 'missing-result')) return '模型未按要求返回图源分析结果';
  return '图源分析结果缺少必要信息或格式不正确';
}

export class FigurePageError extends ModelError {
  constructor(
    readonly pageNumber: number,
    override readonly cause: ModelOutputError,
  ) {
    super(
      'figures',
      'invalid-figure-output',
      `PDF 第 ${pageNumber} 页图源分析失败：${outputProblem(cause)}，自动修复后仍未通过检查。已保存的论文解析仍保留，请重试当前步骤。`,
    );
  }
}

type FigurePageRequest = {
  settings: ModelSettings;
  context: {
    pageNumber: number;
    pageText: string;
    imageRegions: Awaited<ReturnType<PdfResource['imageRegions']>>;
  };
  image: string;
  signal: AbortSignal;
};

/** 仅对当前图页的非法输出修复一次，复用原图与校验诊断；不重试请求错误或提交部分图源。 */
export async function requestFigurePage({ settings, context, image, signal }: FigurePageRequest) {
  const prompt = `${prompts.common}\n\n${prompts.stages.figures}`;
  signal.throwIfAborted();
  try {
    return await requestJson(settings, prompt, context, FigurePageSchema, signal, 'figures', image);
  } catch (cause) {
    signal.throwIfAborted();
    if (!(cause instanceof ModelOutputError)) throw cause;
    try {
      return await requestJson(
        settings,
        `${prompt}\n\n这是当前图页唯一一次修复请求。根据 failedOutput 和 diagnostics 修复返回格式、必填字段和图源矩形。重新核对同一张原页图片；不要更换页码、编造图源或为通过校验而清空 figures。矩形必须相对完整 PDF 页，不能把像素、百分数或右下角坐标当作 x/y/width/height。无法可靠定位的 Panel 可以不返回，但必须保留可定位的完整 Figure。返回本页完整结果。`,
        { ...context, failedOutput: cause.failedOutput, diagnostics: cause.diagnostics },
        FigurePageSchema,
        signal,
        'figures-repair',
        image,
      );
    } catch (repairCause) {
      signal.throwIfAborted();
      if (!(repairCause instanceof ModelOutputError)) throw repairCause;
      throw new FigurePageError(context.pageNumber, repairCause);
    }
  }
}
