import { z } from 'zod';
import type { Paper } from '../../paper/paper.schema';
import { AssistantError } from '../assistantError';

export const paperReadSchemas = {
  paper_get_overview: z.strictObject({}),
  paper_get_figure: z.strictObject({ figureId: z.string().min(1) }),
  paper_get_claims: z.strictObject({ claimIds: z.array(z.string().min(1)).min(1) }),
};
export const paperReadLabels = {
  paper_get_overview: '读取论文概要',
  paper_get_figure: '查看图源与 Panel',
  paper_get_claims: '核对结论与证据',
};
export const paperReadDescriptions: Record<keyof typeof paperReadSchemas, string> = {
  paper_get_overview: '读取当前论文问题、设计、发现及 Figure/Claim 索引，不返回全文。',
  paper_get_figure: '按原论文 Figure ID 读取图注、Panel 及来源。',
  paper_get_claims: '读取指定 Claim、对应 Evidence 和 Source。',
};
export function paperReadTool(name: keyof typeof paperReadSchemas, args: unknown, paper: Paper) {
  const parsed = paperReadSchemas[name].parse(args);
  if (name === 'paper_get_overview')
    return {
      metadata: paper.metadata,
      studyProfile: paper.studyProfile,
      story: paper.story,
      figures: paper.figures.map(({ id, label }) => ({ id, label })),
      claims: paper.claims.map(({ id, text }) => ({ id, text })),
    };
  if (name === 'paper_get_figure') {
    const figure = paper.figures.find((figure) => figure.id === (parsed as { figureId: string }).figureId);
    if (!figure) throw new AssistantError('unknown-figure', 'Figure 不存在');
    return {
      figure,
      sources: paper.sources.filter((source) =>
        [figure.sourceId, ...figure.panels.map((panel) => panel.sourceId)].includes(source.id),
      ),
    };
  }
  const ids = (parsed as { claimIds: string[] }).claimIds;
  if (ids.some((id) => !paper.claims.some((claim) => claim.id === id)))
    throw new AssistantError('unknown-claim', 'Claim 不存在');
  const claims = paper.claims.filter((claim) => ids.includes(claim.id));
  const evidences = paper.evidences.filter((evidence) =>
    claims.some((claim) => claim.evidenceIds.includes(evidence.id)),
  );
  return {
    claims,
    evidences,
    sources: paper.sources.filter((source) => evidences.some((evidence) => evidence.sourceIds.includes(source.id))),
  };
}
