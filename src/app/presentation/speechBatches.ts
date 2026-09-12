import type { Paper } from '../../modules/paper/model';
import { type Content, ContentError } from '../../modules/presentation/content';
import { speechContext } from './speechContext';

/** 全部发现和全文块均进入生成；按发现数量及传输体积拆批，完整成果仍只提交一次。 */
export function speechBatches(paper: Paper) {
  const size = (batch: Paper) => JSON.stringify(speechContext(batch, paper).context).length;
  if (paper.claims.length <= 16 && size(paper) < 90000) return [paper];
  const empty = (): Paper => ({ ...paper, claims: [], evidences: [], sources: [], blocks: [], figures: [] });
  function withReferences(batch: Paper): Paper {
    const evidenceIds = new Set(batch.claims.flatMap((c) => c.evidenceIds));
    const evidences = paper.evidences.filter(
      (e) => evidenceIds.has(e.id) || batch.evidences.some((b) => b.id === e.id),
    );
    const sourceIds = new Set(evidences.flatMap((e) => e.sourceIds));
    const figures = paper.figures.filter((f) =>
      f.regions.some((r) => [r.sourceId, ...r.panels.map((p) => p.sourceId)].some((id) => sourceIds.has(id))),
    );
    for (const figure of figures) {
      for (const id of figure.captionSourceIds ?? []) sourceIds.add(id);
      for (const region of figure.regions) {
        sourceIds.add(region.sourceId);
        for (const panel of region.panels) {
          sourceIds.add(panel.sourceId);
          for (const link of panel.captionAssociation?.links ?? []) sourceIds.add(link.sourceId);
        }
      }
    }
    const sources = paper.sources.filter((s) => sourceIds.has(s.id));
    const blockIds = new Set([
      ...batch.blocks.map((b) => b.id),
      ...sources.flatMap((s) => (s.textSpan ? [s.textSpan.blockId] : [])),
    ]);
    return { ...batch, evidences, sources, figures, blocks: paper.blocks.filter((b) => blockIds.has(b.id)) };
  }
  const groups: Paper[] = [];
  let current = empty();
  for (const claim of paper.claims) {
    const candidate = withReferences({ ...current, claims: [...current.claims, claim] });
    if (current.claims.length && (candidate.claims.length > 16 || size(candidate) > 90000)) {
      groups.push(current);
      current = withReferences({ ...empty(), claims: [claim] });
    } else current = candidate;
  }
  if (current.claims.length) groups.push(current);
  const usedEvidence = new Set(groups.flatMap((g) => g.evidences.map((e) => e.id)));
  for (const evidence of paper.evidences.filter((e) => !usedEvidence.has(e.id))) {
    const last = groups[groups.length - 1] ?? empty();
    const candidate = withReferences({ ...last, evidences: [...last.evidences, evidence] });
    if (size(candidate) < 90000 && groups.length) groups[groups.length - 1] = candidate;
    else groups.push(withReferences({ ...empty(), evidences: [evidence] }));
  }
  // 全文中未被原分析引用的段落也送入上下文，避免沿用上游提取遗漏。
  const usedBlocks = new Set(groups.flatMap((g) => g.blocks.map((b) => b.id)));
  for (const block of paper.blocks.filter((b) => !usedBlocks.has(b.id))) {
    const candidateIndex = groups.findIndex((g) => size({ ...g, blocks: [...g.blocks, block] }) < 90000);
    if (candidateIndex >= 0) groups[candidateIndex].blocks.push(block);
    else groups.push({ ...empty(), blocks: [block] });
  }
  for (const group of groups) {
    // 同页仅提供候选图像，引用仍由生成结果基于原图选择，不能由页码自动配对。
    const pages = new Set(group.sources.map((source) => source.documentId + ':' + source.pageNumber));
    const candidates = paper.figures.filter((figure) =>
      figure.regions.some((region) => {
        const source = paper.sources.find((source) => source.id === region.sourceId);
        return source && pages.has(source.documentId + ':' + source.pageNumber);
      }),
    );
    const sourceIds = new Set(group.sources.map((source) => source.id));
    for (const figure of candidates) {
      if (!group.figures.some((existing) => existing.id === figure.id)) group.figures.push(figure);
      for (const id of figure.captionSourceIds ?? []) sourceIds.add(id);
      for (const region of figure.regions) {
        sourceIds.add(region.sourceId);
        for (const panel of region.panels) {
          sourceIds.add(panel.sourceId);
          for (const link of panel.captionAssociation?.links ?? []) sourceIds.add(link.sourceId);
        }
      }
    }
    group.sources = paper.sources.filter((source) => sourceIds.has(source.id));
    if (size(group) > 140000) throw new ContentError('evidence-capacity', '单项发现的证据过长，已保留完整底稿与讲稿。');
  }
  return groups;
}
/** 批次临时身份各自隔离；完整合并后才交给同一校验与保存入口。 */
export function combineSpeech(parts: Content[]): Content {
  const result: Content = {
    title: parts[0].title,
    language: parts[0].language,
    sections: [],
    speechParagraphs: [],
    speech: [],
    omissions: [],
  };
  for (const [index, part] of parts.entries()) {
    const prefix = (id: string) => 'batch' + index + ':' + id;
    result.sections.push(...part.sections.map((s) => ({ ...s, id: prefix(s.id) })));
    result.speechParagraphs.push(
      ...part.speechParagraphs.map((p) => ({
        ...p,
        id: prefix(p.id),
        sectionId: prefix(p.sectionId),
        segmentIds: p.segmentIds.map(prefix),
      })),
    );
    result.speech.push(...part.speech.map((s) => ({ ...s, id: prefix(s.id), paragraphId: prefix(s.paragraphId) })));
    result.omissions.push(...part.omissions);
  }
  return result;
}
