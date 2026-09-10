import { z } from 'zod';
import { BBoxSchema } from '../../shared/schema';
import { toPageBox } from '../../modules/paper/figureGeometry';
import type { FigureCommand } from '../../modules/paper/figureEditing';
import type { AnalysisProject } from './ports';
import type { FigureResources } from './figureResources';
import type { createModelRequests } from '../llm/requests';
import type { ModelSettings } from '../settings/modelSettings';
import { PaperError } from '../../modules/paper/model';

export const LocalPanelsSchema = z.strictObject({
  panels: z.array(z.strictObject({ label: z.string(), description: z.string(), bbox: BBoxSchema })),
  concerns: z.array(z.string()),
});
/** Explicit button workflow; output is a session candidate and never writes through model tools. */
export async function recognizeFigure(input: {
  data: AnalysisProject;
  figureId: string;
  resources: FigureResources;
  settings: ModelSettings;
  requests: ReturnType<typeof createModelRequests>;
  signal: AbortSignal;
}): Promise<FigureCommand> {
  const { paper } = input.data;
  const figure = structuredClone(paper.figures.find((item) => item.id === input.figureId));
  if (!figure) throw new PaperError('missing-figure', '当前图已不存在。');
  const sources = [];
  for (const region of figure.regions) {
    input.signal.throwIfAborted();
    const source = paper.sources.find((item) => item.id === region.sourceId)!;
    sources.push(structuredClone(source));
    const local = await input.resources.local(source.documentId, source.pageNumber, source.bbox!, input.signal);
    try {
      let result: z.infer<typeof LocalPanelsSchema> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await input.requests.requestJson({
            settings: input.settings,
            schema: LocalPanelsSchema,
            stage: 'figure-local',
            signal: input.signal,
            image: local.image,
            systemPrompt:
              '只分析此局部高清科研图。返回真实可见标签、可独立理解且保留坐标轴/图例/比例尺/统计标注的粗矩形。bbox基于当前局部图片归一化，不能使用原页坐标。共享图例可重叠；不得按标签中点或阅读顺序猜标签，不重绘或擦除像素。没有必要细分时返回空panels并解释concerns；图注提到但图片不可见的Panel标为疑点，不能补造。description用中文解释可见内容，不能推定原文结果。' +
              (attempt ? '上次结构无效，这是唯一一次完整修复。' : ''),
            data: {
              figure: figure.label,
              caption: figure.caption,
              captionSources: paper.sources.filter((item) => figure.captionSourceIds?.includes(item.id)),
              file: paper.documents.find((doc) => doc.id === source.documentId)?.fileName,
              pageNumber: source.pageNumber,
            },
          });
          break;
        } catch (cause) {
          if (
            attempt ||
            input.signal.aborted ||
            !(cause instanceof Error && (cause.name === 'ModelOutputError' || 'diagnostics' in cause))
          )
            throw cause;
        }
      }
      figure.description = [...new Set([figure.description, ...result!.concerns].filter(Boolean))].join('\n');
      const refined = await local.refine(result!.panels.map((panel) => panel.bbox));
      const old = region.panels;
      region.panels = result!.panels.map((panel, index) => {
        const matching = old.filter((item) => panel.label && item.label?.toLowerCase() === panel.label.toLowerCase());
        const same =
          matching.length === 1 && result!.panels.filter((item) => item.label === panel.label).length === 1
            ? matching[0]
            : undefined;
        const id = same?.id ?? crypto.randomUUID();
        const sourceId = same?.sourceId && same.sourceId !== source.id ? same.sourceId : `${id}:source`;
        sources.push({
          ...source,
          id: sourceId,
          kind: 'panel' as const,
          bbox: toPageBox(refined.boxes[index], source.bbox!),
          geometryOrigin: 'automatic' as const,
        });
        return {
          id,
          sourceId,
          label: panel.label || undefined,
          labelOrigin: 'automatic' as const,
          description: [panel.description, ...refined.issues[index], ...result!.concerns].join('\n'),
          captionAssociation: same?.captionAssociation,
        };
      });
    } finally {
      local.release();
    }
  }
  return { kind: 'replace-figure', figureId: figure.id, figure, sources, baseline: true };
}
