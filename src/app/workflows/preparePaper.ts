import type { PromptCatalog } from '../llm/promptCatalog';
import { z } from 'zod';
import { LocalPanelsSchema } from '../paper/recognizeFigure';
import { toPageBox } from '../../modules/paper/figureGeometry';
import {
  type EvidenceResult,
  type FigureResult,
  getAnalysisProgress,
  getEvidenceContext,
  getUnitInputKey,
  isSelected,
  PaperAnalysisError,
  pageKey,
  unitComplete,
} from '../../modules/paper/analysisUnits';
import { FigurePageSchema } from '../../modules/paper/figureOutput';
import type { AnalysisStage, AnalysisUnitTarget, Paper } from '../../modules/paper/model';
import { ClaimSchema, EvidenceSchema } from '../../modules/paper/paper.schema';
import { ModelError, ModelOutputError } from '../llm/modelError';
import type { createModelRequests } from '../llm/requests';
import type { AnalysisProject, AnalysisStore, PaperResource, ResourceFactory } from '../paper/ports';
import { SummarySchema, summarizePaper } from '../paper/summarizePaper';
import { SummaryReferenceError } from '../paper/summaryReferences';
import type { ModelSettings } from '../settings/modelSettings';

type Requests = ReturnType<typeof createModelRequests>;
const FindingSchema = z.strictObject({ claims: z.array(ClaimSchema), evidences: z.array(EvidenceSchema) });
export type AnalysisEvent = { stage: string; documentId?: string; pageNumber?: number; data?: AnalysisProject };

/** 并行单元的失败携带其输入身份；UI 不从最后一条兄弟进度推断文件与页码。 */
export class AnalysisUnitError extends Error {
  readonly recovery = '已保存单元保留，重试该文件页面的未完成分析。';
  readonly code: string;
  readonly documentId?: string;
  readonly pageNumber?: number;
  constructor(
    readonly stage: string,
    context: unknown,
    cause: unknown,
  ) {
    const location = z
      .object({ document: z.object({ id: z.string(), fileName: z.string() }), pageNumber: z.number().int().positive() })
      .safeParse(context);
    const label = location.success
      ? `${location.data.document.fileName} · 第 ${location.data.pageNumber} 页`
      : '全部材料汇总';
    let code = 'analysis-failed';
    let message = '本单元分析失败，最近保存的成果仍保留，请重试。';
    if (cause instanceof ModelError || cause instanceof PaperAnalysisError) {
      code = cause.code;
      message = cause.message;
    } else if (cause instanceof z.ZodError) {
      code = 'invalid-output';
      message = '模型结果未通过本单元校验，最近保存的成果仍保留，请重试。';
    }
    super(`${label}：${message}`);
    this.code = code;
    if (location.success) {
      this.documentId = location.data.document.id;
      this.pageNumber = location.data.pageNumber;
    }
  }
}

/** 固定分析工作流：独立页受限并行，完整单元逐个提交，整篇汇总等待全部真实依赖。 */
export async function preparePaper({
  prompts,
  projectId,
  settings,
  store,
  createResource,
  requests,
  signal,
  onProgress,
}: {
  prompts: PromptCatalog;
  projectId: string;
  settings: ModelSettings;
  store: AnalysisStore;
  createResource: ResourceFactory;
  requests: Requests;
  signal: AbortSignal;
  onProgress: (event: AnalysisEvent) => void;
}) {
  await store.prepareWorkspace?.(projectId);
  let data = await store.openProject(projectId);
  const resources = new Map<string, PaperResource>();
  let saveQueue = Promise.resolve();
  const resourceFor = (documentId: string) => {
    let resource = resources.get(documentId);
    if (!resource) {
      const asset = data.assets[documentId];
      if (!asset) throw new PaperAnalysisError('missing-pdf', '原 PDF 缺失，请保留项目并检查本地文件。');
      resource = createResource(asset.blob);
      resources.set(documentId, resource);
    }
    return resource;
  };
  const report = (stage: string, target?: AnalysisUnitTarget) => {
    signal.throwIfAborted();
    onProgress({
      stage,
      documentId: target?.kind === 'page' ? target.documentId : undefined,
      pageNumber: target?.kind === 'page' ? target.pageNumber : undefined,
    });
  };
  async function commit(
    stage: AnalysisStage,
    target: AnalysisUnitTarget,
    inputKey: string,
    result: unknown,
    outcome: 'completed' | 'no-figure-located' = 'completed',
  ) {
    const queued = saveQueue.then(async () => {
      signal.throwIfAborted();
      data = await store.commitUnit({
        projectId,
        paperId: data.paper.id,
        stage,
        target,
        inputKey,
        result,
        outcome,
        signal,
      });
      signal.throwIfAborted();
      onProgress({ stage: '已保存', data });
    });
    saveQueue = queued.catch(() => {});
    await queued;
  }
  async function parallel<T>(items: T[], work: (item: T) => Promise<void>) {
    let cursor = 0;
    let failure: unknown;
    const worker = async () => {
      while (cursor < items.length && !failure) {
        signal.throwIfAborted();
        const item = items[cursor++];
        try {
          await work(item);
        } catch (cause) {
          failure = cause;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (failure) throw failure;
  }
  async function modelUnit<T extends z.ZodType>(
    schema: T,
    stage: string,
    context: unknown,
    prompt: string,
    validate: (result: z.infer<T>) => void,
    image?: string,
  ) {
    let diagnostic = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await requests.requestJson({
          settings,
          schema,
          stage,
          signal,
          image,
          maxTokens: stage === 'understand-summary' ? 24576 : undefined,
          systemPrompt:
            prompt +
            (diagnostic
              ? `\n这是唯一一次格式/引用修复：${diagnostic}。${stage === 'understand-summary' ? '返回完整Summary结构，以少数主题综合点保留关键差异和必要引用；底稿已完整保存，无需逐条复述，不用空结果规避。' : '完整返回当前单元，不得用删减发现或空结果规避错误。'}`
              : ''),
          data: context,
        });
        validate(result);
        return result;
      } catch (cause) {
        signal.throwIfAborted();
        if (
          !(cause instanceof PaperAnalysisError) &&
          !(cause instanceof z.ZodError) &&
          !(cause instanceof ModelOutputError)
        )
          throw new AnalysisUnitError(stage, context, cause);
        if (attempt) throw new AnalysisUnitError(stage, context, cause);
        diagnostic =
          cause instanceof SummaryReferenceError
            ? cause.repairDiagnostic
            : cause instanceof ModelOutputError
              ? JSON.stringify(cause.diagnostics)
              : cause instanceof Error
                ? cause.message
                : '输出未通过引用检查';
        if (stage === 'understand-summary') diagnostic = diagnostic.slice(0, 4000);
      }
    }
    throw new AnalysisUnitError(stage, context, new PaperAnalysisError('invalid-output', '分析结果未通过检查。'));
  }
  try {
    for (const document of data.paper.documents) {
      const resource = resourceFor(document.id);
      const pageCount = await resource.pageCount();
      const title = document.role === 'primary' ? await resource.title() : undefined;
      await parallel(
        Array.from({ length: pageCount }, (_, index) => index + 1),
        async (pageNumber) => {
          const target = { kind: 'page' as const, documentId: document.id, pageNumber };
          if (!unitComplete(data.paper, 'text', target)) {
            report('提取全文', target);
            const inputKey = getUnitInputKey(data.paper, 'text', target);
            const page = await resource.text(pageNumber, signal);
            const blocks = page.blocks.map((block, index) => ({
              id: `text:${pageKey(document.id, pageNumber)}:${index}`,
              kind: (/^(?:Fig(?:ure)?\.?\s*\d|[Ss]\d+\s+(?:Fig|Table)|图\s*\d)/i.test(block.text.trim())
                ? 'caption'
                : /^Table\s+\d/i.test(block.text.trim())
                  ? 'table'
                  : 'paragraph') as Paper['blocks'][number]['kind'],
              text: block.text,
            }));
            await commit('text', target, inputKey, {
              width: page.width,
              height: page.height,
              pageCount,
              metadataTitle: title,
              blocks,
            });
          }
          if (!unitComplete(data.paper, 'figure-discovery', target)) {
            report('发现图源页', target);
            const text = data.paper.blocks
              .filter((block) => block.documentId === document.id && block.pageNumber === pageNumber)
              .map((block) => block.text)
              .join('\n');
            const discovery = await resource.discover(pageNumber, signal);
            const caption =
              /(?:^|\n)\s*(?:(?:Fig(?:ure)?\.?\s*(?:S\s*)?\d+)|(?:S\d+\s+Fig(?:ure)?)|(?:图\s*\d+))\b/i.test(text);
            const automatic = discovery.hasImages || caption ? 'detected' : 'not-detected';
            await commit('figure-discovery', target, getUnitInputKey(data.paper, 'figure-discovery', target), {
              automatic,
            });
          }
        },
      );
      const textSize = data.paper.blocks
        .filter((block) => block.documentId === document.id)
        .reduce((total, block) => total + block.text.trim().length, 0);
      if (textSize < 100)
        throw new PaperAnalysisError(
          'unreadable-document',
          `${document.fileName} 未提取到足够文字；扫描件暂不支持，请使用可解析版本。`,
        );
    }
    // 运行中人工补选进入下一轮；每次以最新保存选择为准。
    while (true) {
      data = await store.openProject(projectId);
      const pending = data.paper.figurePageSelections.filter(
        (page) =>
          isSelected(page) &&
          !unitComplete(data.paper, 'figure-location', {
            kind: 'page',
            documentId: page.documentId,
            pageNumber: page.pageNumber,
          }),
      );
      if (!pending.length) break;
      await parallel(pending, async (page) => {
        const target = { kind: 'page' as const, documentId: page.documentId, pageNumber: page.pageNumber };
        const captured = data.paper;
        const inputKey = getUnitInputKey(captured, 'figure-location', target);
        report('分析 Figure / Panel', target);
        const context = {
          document: captured.documents.find((doc) => doc.id === page.documentId),
          pageNumber: page.pageNumber,
          pageText: captured.blocks
            .filter((block) => block.documentId === page.documentId && block.pageNumber === page.pageNumber)
            .map((block) => block.text)
            .join('\n'),
        };
        const image = await resourceFor(page.documentId).figureInput(page.pageNumber, signal);
        const output = await modelUnit(
          FigurePageSchema,
          'figures',
          { ...context, imageRegions: image.imageRegions },
          `${prompts.common}\n${prompts.stages.figures}`,
          () => {},
          image.image,
        );
        const localResource = resourceFor(page.documentId);
        if (localResource.localFigure) {
          for (const figure of output.figures) {
            report('局部高清识别与边界核对', target);
            const local = await localResource.localFigure(page.pageNumber, figure.bbox, signal);
            try {
              const panels = await modelUnit(
                LocalPanelsSchema,
                'figure-local',
                { ...context, figureLabel: figure.label, caption: figure.caption },
                '识别当前局部高清图内真实可见的 Panel 标签、内容和矩形，bbox 使用局部图归一化坐标。保留坐标轴、图例、比例尺和科学统计标注，共享标注允许重叠。不按位置猜标签，不重绘或擦除像素。对照图注标出漏图、重复或无法完整独立裁切的疑点于 concerns；description 用中文说明可见图像内容。没有必要细分时允许空 panels。',
                () => {},
                local.image,
              );
              figure.description = [figure.description, ...panels.concerns].filter(Boolean).join('\n');
              const refined = await local.refine(panels.panels.map((panel) => panel.bbox));
              figure.panels = panels.panels.map((panel, index) => ({
                ...panel,
                label: panel.label || '',
                bbox: toPageBox(refined.boxes[index], figure.bbox),
                description: [panel.description, ...refined.issues[index], ...panels.concerns].join('\n'),
              }));
            } finally {
              local.release();
            }
          }
        }
        const result: FigureResult = { sources: [], figures: [] };
        for (const [index, figure] of output.figures.entries()) {
          const id = `figure:${pageKey(page.documentId, page.pageNumber)}:${index}`;
          const sourceId = `${id}:source`;
          result.sources.push({
            id: sourceId,
            documentId: page.documentId,
            pageNumber: page.pageNumber,
            kind: 'figure',
            bbox: figure.bbox,
            geometryOrigin: 'automatic',
          });
          const panels = figure.panels.map((panel, index) => {
            const panelId = `${id}:panel:${index}`;
            result.sources.push({
              id: `${panelId}:source`,
              documentId: page.documentId,
              pageNumber: page.pageNumber,
              kind: 'panel',
              bbox: panel.bbox,
              geometryOrigin: 'automatic',
            });
            return {
              id: panelId,
              label: panel.label,
              description: panel.description,
              sourceId: `${panelId}:source`,
              labelOrigin: 'automatic' as const,
            };
          });
          result.figures.push({
            id,
            label: figure.label,
            caption: figure.caption,
            description: figure.description,
            regions: [{ id: `${id}:region`, sourceId, panels }],
          });
        }
        try {
          await commit(
            'figure-location',
            target,
            inputKey,
            result,
            output.figures.length ? 'completed' : 'no-figure-located',
          );
        } catch (cause) {
          const latest = await store.openProject(projectId);
          if (getUnitInputKey(latest.paper, 'figure-location', target) === inputKey) throw cause;
          data = latest;
        }
      });
    }
    data = await store.openProject(projectId);
    await parallel(data.paper.pages, async (page) => {
      const target = { kind: 'page' as const, documentId: page.documentId, pageNumber: page.pageNumber };
      if (unitComplete(data.paper, 'evidence', target)) return;
      report('整理本页发现与证据', target);
      const paper = data.paper;
      const inputKey = getUnitInputKey(paper, 'evidence', target);
      const context = getEvidenceContext(paper, page);
      const { sources } = context;
      const sourceIds = new Set(sources.map((source) => source.id));
      const result = await modelUnit(
        FindingSchema,
        'understand-page',
        {
          document: paper.documents.find((doc) => doc.id === page.documentId),
          pageNumber: page.pageNumber,
          ...context,
        },
        `${prompts.common}\n${prompts.stages['extract-evidence']}`,
        (output) => {
          const ids = [...output.claims, ...output.evidences].map((item) => item.id);
          if (
            new Set(ids).size !== ids.length ||
            output.evidences.some((item) => item.sourceIds.some((id) => !sourceIds.has(id))) ||
            output.claims.some(
              (item) =>
                !item.evidenceIds.length ||
                item.evidenceIds.some((id) => !output.evidences.some((evidence) => evidence.id === id)),
            )
          )
            throw new PaperAnalysisError('invalid-evidence', '本页发现与证据引用不完整。');
        },
      );
      const prefix = `finding:${pageKey(page.documentId, page.pageNumber)}:`;
      const evidence: EvidenceResult = {
        claims: result.claims.map((claim) => ({
          ...claim,
          id: prefix + claim.id,
          evidenceIds: claim.evidenceIds.map((id) => prefix + id),
        })),
        evidences: result.evidences.map((item) => ({ ...item, id: prefix + item.id })),
      };
      await commit('evidence', target, inputKey, evidence);
    });
    data = await store.openProject(projectId);
    if (!getAnalysisProgress(data.paper).figuresReady)
      return preparePaper({ prompts, projectId, settings, store, createResource, requests, signal, onProgress });
    if (!unitComplete(data.paper, 'evidence', { kind: 'paper' })) {
      report('汇总全部材料与跨文件证据');
      const paper = data.paper;
      const target = { kind: 'paper' as const };
      const inputKey = getUnitInputKey(paper, 'evidence', target);
      const summary = await summarizePaper({
        paper,
        prompt: `${prompts.common}\n${prompts.stages['summarize-paper']}`,
        signal,
        onProgress: (stage) => report(stage),
        request: (context, prompt, validate) =>
          modelUnit(SummarySchema, 'understand-summary', context, prompt, validate),
      });
      await commit('evidence', target, inputKey, summary);
    }
    return data;
  } finally {
    await Promise.all([...resources.values()].map((resource) => resource.dispose()));
  }
}
