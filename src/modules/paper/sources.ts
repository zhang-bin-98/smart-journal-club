import { PaperSchema, type Paper as LegacyPaper } from './paper.schema';
import type { Paper as CurrentPaper } from './model';
type Paper = LegacyPaper | CurrentPaper;

/** 论文图源定位：Deck 侧先把 Figure 元素转换为本结构，Paper 来源解析不感知 Deck 元素。 */
export type FigureSourceLocator = { figureId: string; regionId?: string; panelId?: string };
export function figureSource(paper: Paper, locator: FigureSourceLocator) {
  const figure = paper.figures.find((item) => item.id === locator.figureId);
  if (!figure) throw new Error('Figure 不存在');
  if ('regions' in figure) {
    const region = locator.regionId
      ? figure.regions.find((item) => item.id === locator.regionId)
      : locator.panelId
        ? figure.regions.find((item) => item.panels.some((panel) => panel.id === locator.panelId))
        : figure.regions[0];
    const id = locator.panelId
      ? region?.panels.find((panel) => panel.id === locator.panelId)?.sourceId
      : region?.sourceId;
    const source = paper.sources.find((item) => item.id === id);
    if (!source?.bbox) throw new Error('图源缺失，无法查看或导出');
    return source;
  }
  const sourceId = locator.panelId
    ? figure.panels.find((panel) => panel.id === locator.panelId)?.sourceId
    : figure.sourceId;
  const source = paper.sources.find((item) => item.id === sourceId);
  if (!source?.bbox) throw new Error('图源缺失，无法查看或导出');
  return source;
}
export function validatePaper(input: unknown, ready = false): LegacyPaper {
  const paper = PaperSchema.parse(input);
  const ids = new Set<string>();
  const addId = (id: string) => {
    if (ids.has(id)) throw new Error(`论文中有重复 ID：${id}`);
    ids.add(id);
  };
  const pages = new Set(paper.pages.map((page) => page.pageNumber));
  if (pages.size !== paper.pages.length || paper.pages.some((page, index) => page.pageNumber !== index + 1))
    throw new Error('论文页码不连续');
  paper.sources.forEach((source) => {
    addId(source.id);
    if (!pages.has(source.pageNumber)) throw new Error('来源页码不存在');
    if ((source.kind === 'figure' || source.kind === 'panel') && !source.bbox) throw new Error('图源必须有 bbox');
  });
  paper.figures.forEach((figure) => {
    addId(figure.id);
    const source = paper.sources.find((item) => item.id === figure.sourceId);
    if (!source?.bbox || source.kind !== 'figure') throw new Error('Figure 来源无效');
    figure.panels.forEach((panel) => {
      addId(panel.id);
      const panelSource = paper.sources.find((item) => item.id === panel.sourceId);
      if (
        !panelSource?.bbox ||
        !['panel', 'figure'].includes(panelSource.kind) ||
        panelSource.pageNumber !== source.pageNumber
      )
        throw new Error('Panel 与 Figure 来源不在同一页');
    });
  });
  const hasSources = (values: string[]) => values.every((id) => paper.sources.some((source) => source.id === id));
  paper.evidences.forEach((evidence) => {
    addId(evidence.id);
    if (!hasSources(evidence.sourceIds)) throw new Error('Evidence 来源不存在');
  });
  paper.claims.forEach((claim) => {
    addId(claim.id);
    if (!claim.evidenceIds.every((id) => paper.evidences.some((evidence) => evidence.id === id)))
      throw new Error('Claim 证据不存在');
    if (ready && claim.importance === 'primary' && !claim.evidenceIds.length) throw new Error('主要结论缺少证据');
  });
  if (paper.studyProfile && !hasSources(paper.studyProfile.sourceIds)) throw new Error('研究设计来源不存在');
  if (paper.story)
    Object.values(paper.story)
      .flat()
      .forEach((point) => {
        if (
          !hasSources(point.sourceIds) ||
          !point.claimIds.every((id) => paper.claims.some((claim) => claim.id === id))
        )
          throw new Error('故事点引用不存在');
        if (ready && !point.sourceIds.length && !point.claimIds.length) throw new Error('故事点缺少依据');
      });
  if (ready && (!paper.studyProfile || !paper.story || !paper.claims.some((claim) => claim.importance === 'primary')))
    throw new Error('论文理解缺少研究设计、故事或主要结论');
  return paper;
}

export function sourceText(paper: Paper, sourceIds: string[]) {
  if (paper.schemaVersion === 2)
    return [
      ...new Set(
        sourceIds
          .map((id) => {
            const source = paper.sources.find((item) => item.id === id);
            const doc = paper.documents.find((item) => item.id === source?.documentId);
            return source ? `${doc?.role === 'supplement' ? '补充材料' : '主论文'}第 ${source.pageNumber} 页` : '';
          })
          .filter(Boolean),
      ),
    ].join(' · ');
  return [
    ...new Set(sourceIds.map((id) => paper.sources.find((source) => source.id === id)?.pageNumber).filter(Boolean)),
  ]
    .map((page) => `论文第 ${page} 页`)
    .join(' · ');
}

/** 自动页脚不重复 Citation 已覆盖的论文页；不同 Source 指向同页时同样视为已覆盖。 */
export function sourceIdsExcludingPages(paper: Paper, sourceIds: string[], excludedSourceIds: string[]) {
  const excludedPages = new Set(
    excludedSourceIds.flatMap((id) => {
      const source = paper.sources.find((source) => source.id === id);
      return source ? [`${'documentId' in source ? source.documentId : ''}:${source.pageNumber}`] : [];
    }),
  );
  return sourceIds.filter((id) => {
    const source = paper.sources.find((source) => source.id === id);
    return !source || !excludedPages.has(`${'documentId' in source ? source.documentId : ''}:${source.pageNumber}`);
  });
}
