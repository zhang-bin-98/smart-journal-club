import { z } from 'zod';
import type { Paper } from '../../paper/paper.schema';

export const paperReadSchemas = {
  'paper.get': z.strictObject({}),
  'paper.get_page': z.strictObject({ pageNumber: z.number().int().positive() }),
  'paper.get_figure': z.strictObject({ figureId: z.string().min(1) }),
  'paper.get_claim': z.strictObject({ claimId: z.string().min(1) }),
};
export const paperReadDescriptions: Record<keyof typeof paperReadSchemas, string> = {
  'paper.get': '读取当前论文概要及 Figure/Claim 索引，不返回全文。',
  'paper.get_page': '读取当前论文一个 PDF 页的文本。',
  'paper.get_figure': '按原论文 Figure ID 读取图注、Panel 及来源。',
  'paper.get_claim': '读取一个 Claim、对应 Evidence 和 Source。',
};
export function paperReadTool(name: keyof typeof paperReadSchemas, args: unknown, paper: Paper) {
  const parsed = paperReadSchemas[name].parse(args);
  if (name === 'paper.get') return { metadata: paper.metadata, studyProfile: paper.studyProfile, pageCount: paper.pages.length, figures: paper.figures.map(({ id, label }) => ({ id, label })), claims: paper.claims.map(({ id, text }) => ({ id, text })) };
  if (name === 'paper.get_page') {
    const page = paper.pages.find(page => page.pageNumber === (parsed as { pageNumber: number }).pageNumber);
    if (!page) throw new Error('论文页码不存在'); return page;
  }
  if (name === 'paper.get_figure') {
    const figure = paper.figures.find(figure => figure.id === (parsed as { figureId: string }).figureId);
    if (!figure) throw new Error('Figure 不存在');
    return { figure, sources: paper.sources.filter(source => [figure.sourceId, ...figure.panels.map(panel => panel.sourceId)].includes(source.id)) };
  }
  const claim = paper.claims.find(claim => claim.id === (parsed as { claimId: string }).claimId);
  if (!claim) throw new Error('Claim 不存在');
  const evidences = paper.evidences.filter(evidence => claim.evidenceIds.includes(evidence.id));
  return { claim, evidences, sources: paper.sources.filter(source => evidences.some(evidence => evidence.sourceIds.includes(source.id))) };
}
