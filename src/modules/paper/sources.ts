import { PaperSchema, type Paper } from './paper.schema';
import { BBoxSchema, type BBox } from '../../shared/schema';
import type { PdfResource } from '../../shared/pdf/pdfResource';

/** 论文图源定位：Deck 侧先把 Figure 元素转换为本结构，Paper 来源解析不感知 Deck 元素。 */
export type FigureSourceLocator = { figureId: string; panelId?: string };
export function figureSource(paper: Paper, locator: FigureSourceLocator) {
  const figure = paper.figures.find(item => item.id === locator.figureId);
  if (!figure) throw new Error('Figure 不存在');
  const sourceId = locator.panelId ? figure.panels.find(panel => panel.id === locator.panelId)?.sourceId : figure.sourceId;
  const source = paper.sources.find(item => item.id === sourceId);
  if (!source?.bbox) throw new Error('图源缺失，无法查看或导出');
  return source;
}
/** Deck Figure 元素 → 定位/覆盖框 → PDF 裁图的薄适配；渲染本身由 shared/pdf 承担。 */
export function figureImage(resource: PdfResource, paper: Paper, locator: FigureSourceLocator, cropOverride?: BBox, edge?: number) {
  const source = figureSource(paper, locator);
  return resource.image(source, BBoxSchema.parse(cropOverride ?? source.bbox), edge);
}

export function validatePaper(input: unknown, ready = false): Paper {
  const paper = PaperSchema.parse(input);
  const ids = new Set<string>();
  const addId = (id: string) => { if (ids.has(id)) throw new Error('论文中有重复 ID：' + id); ids.add(id); };
  const pages = new Set(paper.pages.map(page => page.pageNumber));
  if (pages.size !== paper.pages.length || paper.pages.some((page, index) => page.pageNumber !== index + 1)) throw new Error('论文页码不连续');
  paper.sources.forEach(source => {
    addId(source.id);
    if (!pages.has(source.pageNumber)) throw new Error('来源页码不存在');
    if ((source.kind === 'figure' || source.kind === 'panel') && !source.bbox) throw new Error('图源必须有 bbox');
  });
  paper.figures.forEach(figure => {
    addId(figure.id);
    const source = paper.sources.find(item => item.id === figure.sourceId);
    if (!source?.bbox || source.kind !== 'figure') throw new Error('Figure 来源无效');
    figure.panels.forEach(panel => {
      addId(panel.id);
      const panelSource = paper.sources.find(item => item.id === panel.sourceId);
      if (!panelSource?.bbox || !['panel', 'figure'].includes(panelSource.kind) || panelSource.pageNumber !== source.pageNumber) throw new Error('Panel 与 Figure 来源不在同一页');
    });
  });
  const hasSources = (values: string[]) => values.every(id => paper.sources.some(source => source.id === id));
  paper.evidences.forEach(evidence => { addId(evidence.id); if (!hasSources(evidence.sourceIds)) throw new Error('Evidence 来源不存在'); });
  paper.claims.forEach(claim => {
    addId(claim.id);
    if (!claim.evidenceIds.every(id => paper.evidences.some(evidence => evidence.id === id))) throw new Error('Claim 证据不存在');
    if (ready && claim.importance === 'primary' && !claim.evidenceIds.length) throw new Error('主要结论缺少证据');
  });
  if (paper.studyProfile && !hasSources(paper.studyProfile.sourceIds)) throw new Error('研究设计来源不存在');
  if (paper.story) Object.values(paper.story).flat().forEach(point => {
    if (!hasSources(point.sourceIds) || !point.claimIds.every(id => paper.claims.some(claim => claim.id === id))) throw new Error('故事点引用不存在');
    if (ready && !point.sourceIds.length && !point.claimIds.length) throw new Error('故事点缺少依据');
  });
  if (ready && (!paper.studyProfile || !paper.story || !paper.claims.some(claim => claim.importance === 'primary'))) throw new Error('论文理解缺少研究设计、故事或主要结论');
  return paper;
}

export function sourceText(paper: Paper, sourceIds: string[]) {
  return [...new Set(sourceIds.map(id => paper.sources.find(source => source.id === id)?.pageNumber).filter(Boolean))].map(page => `论文第 ${page} 页`).join(' · ');
}
