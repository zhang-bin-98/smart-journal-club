import { getEvidenceContext } from '../../modules/paper/analysisUnits';
import type { Paper } from '../../modules/paper/model';

/** 当前页完整保留；其余语境以完整块、真实来源按剩余容量加入，不截短原文。 */
export function selectEvidenceContext(
  paper: Paper,
  target: { documentId: string; pageNumber: number },
  fits: (context: ReturnType<typeof getEvidenceContext>) => boolean,
) {
  const available = getEvidenceContext(paper, target);
  const selected: ReturnType<typeof getEvidenceContext> = {
    blocks: available.blocks,
    contextBefore: [],
    contextAfter: [],
    sectionContext: [],
    studyContext: [],
    sources: [],
  };
  const included = new Set(available.blocks.map((block) => block.id));
  const updateSources = () => {
    selected.sources = available.sources.filter(
      (source) =>
        (source.documentId === target.documentId && source.pageNumber === target.pageNumber) ||
        (source.textSpan && included.has(source.textSpan.blockId)),
    );
  };
  updateSources();
  for (const key of ['contextBefore', 'contextAfter', 'studyContext', 'sectionContext'] as const) {
    const candidates = key === 'contextBefore' ? [...available[key]].reverse() : (available[key] ?? []);
    for (const block of candidates) {
      if (included.has(block.id)) continue;
      selected[key]!.push(block);
      included.add(block.id);
      updateSources();
      if (!fits(selected)) {
        selected[key]!.pop();
        included.delete(block.id);
        updateSources();
      }
    }
  }
  selected.contextBefore.reverse();
  return selected;
}
