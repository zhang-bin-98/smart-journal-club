import { z } from 'zod';
import { BBoxSchema, ClaimSchema, EvidenceSchema, MetadataSchema, StorySchema, StudyProfileSchema, type Paper } from './types';
import { requestJson, type ModelSettings } from './model';
import { prompts } from './prompts';
import { validatePaper } from './sources';
import { PdfResource } from './pdf';
import { saveStage, type ProjectData } from './storage';

export const FigurePageSchema = z.strictObject({ figures: z.array(z.strictObject({
  label: z.string().min(1), caption: z.string(), description: z.string(), bbox: BBoxSchema,
  panels: z.array(z.strictObject({ label: z.string().min(1), description: z.string(), bbox: BBoxSchema.describe('必填：此 Panel 在完整 PDF 页中的 x/y/width/height 归一化矩形。无法确定坐标则不返回该 Panel。') })),
})) });
export const UnderstandingSchema = z.discriminatedUnion('supported', [
  z.strictObject({ supported: z.literal(false), reason: z.string().min(1) }),
  z.strictObject({ supported: z.literal(true), strategyId: z.string().min(1), metadata: MetadataSchema, studyProfile: StudyProfileSchema, claims: z.array(ClaimSchema), evidences: z.array(EvidenceSchema), story: StorySchema }),
]);
const ANALYSIS_EDGE = 1800;
export function candidatePages(paper: Paper) {
  return paper.pages.filter(page => /\b(?:Fig(?:ure)?\.?\s*\d+\s*[.:])|图\s*\d+\s*[.：:]/i.test(page.text));
}
export async function analyzeFigures(paper: Paper, resource: PdfResource, settings: ModelSettings, signal: AbortSignal): Promise<Paper> {
  const working: Paper = { ...structuredClone(paper), sources: paper.sources.filter(source => source.kind !== 'figure' && source.kind !== 'panel'), figures: [] };
  for (const page of candidatePages(paper)) {
    signal.throwIfAborted(); const canvas = document.createElement('canvas');
    let image: string;
    try { await resource.render(page.pageNumber, canvas, ANALYSIS_EDGE, signal); image = canvas.toDataURL('image/png'); }
    finally { canvas.width = 0; canvas.height = 0; }
    const output = await requestJson(settings, prompts.common + '\n\n' + prompts.stages.figures, { pageNumber: page.pageNumber, pageText: page.text }, FigurePageSchema, signal, 'figures', image);
    for (const figure of output.figures) {
      const sourceId = crypto.randomUUID();
      working.sources.push({ id: sourceId, kind: 'figure', pageNumber: page.pageNumber, bbox: figure.bbox });
      const panels = figure.panels.map(panel => {
        const id = crypto.randomUUID(); working.sources.push({ id, kind: 'panel', pageNumber: page.pageNumber, bbox: panel.bbox });
        return { id: crypto.randomUUID(), label: panel.label, description: panel.description, sourceId: id };
      });
      working.figures.push({ id: crypto.randomUUID(), label: figure.label, caption: figure.caption, description: figure.description, sourceId, panels });
    }
  }
  return validatePaper(working);
}
export function mapUnderstanding(paper: Paper, raw: unknown) {
  const output = UnderstandingSchema.parse(raw);
  if (!output.supported) throw new Error('当前论文不在首版支持范围：' + output.reason);
  if (!prompts.strategies.some(strategy => strategy.id === output.strategyId)) throw new Error('模型返回的研究叙事策略不存在');
  const identifiers = new Map<string, string>();
  [...output.claims, ...output.evidences].forEach(item => { if (identifiers.has(item.id)) throw new Error('模型返回重复 ID'); identifiers.set(item.id, crypto.randomUUID()); });
  const map = (id: string) => { const value = identifiers.get(id); if (!value) throw new Error('模型引用的 Claim 或 Evidence 不存在'); return value; };
  const claims = output.claims.map(claim => ({ ...claim, id: map(claim.id), evidenceIds: claim.evidenceIds.map(map) }));
  const evidences = output.evidences.map(evidence => ({ ...evidence, id: map(evidence.id) }));
  const story = StorySchema.parse(Object.fromEntries(Object.entries(output.story).map(([topic, points]) => [topic, points.map(point => ({ ...point, claimIds: point.claimIds.map(map) }))])));
  const next = validatePaper({ ...paper, metadata: { ...paper.metadata, ...output.metadata }, studyProfile: output.studyProfile, claims, evidences, story }, true);
  return { paper: next, strategyId: output.strategyId };
}
export async function understandPaper(paper: Paper, settings: ModelSettings, instruction: string, signal: AbortSignal) {
  const result = await requestJson(settings, prompts.common + '\n\n' + prompts.stages.understand, {
    instruction, strategies: prompts.strategies, paper,
  }, UnderstandingSchema, signal, 'understand');
  return mapUnderstanding(paper, result);
}
export async function analyzeProject(initial: ProjectData, resource: PdfResource, settings: ModelSettings, signal: AbortSignal,
  onStage: (stage: string) => void, onSaved: (data: ProjectData) => void) {
  let data = initial;
  if (data.project.checkpoint === 'pdf-parsed') {
    onStage('分析 Figure / Panel');
    const paper = await analyzeFigures(data.paper, resource, settings, signal);
    const project = await saveStage(data.project, { checkpoint: 'figures-ready', paper }, signal);
    data = { ...data, paper, project }; onSaved(data);
  }
  if (data.project.checkpoint === 'figures-ready') {
    onStage('理解研究内容');
    const result = await understandPaper(data.paper, settings, data.project.preferences.instruction, signal);
    const project = await saveStage(data.project, { checkpoint: 'paper-ready', ...result }, signal);
    data = { ...data, paper: result.paper, project }; onSaved(data);
  }
  return data;
}
