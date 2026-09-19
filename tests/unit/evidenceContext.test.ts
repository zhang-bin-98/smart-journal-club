import { expect, it } from 'vitest';
import { selectEvidenceContext } from '../../src/app/paper/evidenceContext';
import { getEvidenceContext, getUnitInputKey, unitComplete, unitId } from '../../src/modules/paper/analysisUnits';
import { migratePaperV1 } from '../../src/modules/paper/migration';
import { fixturePaper } from '../fixtures';
import { legacyProject } from '../legacy-fixtures';

function contextPaper() {
  const paper = migratePaperV1(
    fixturePaper,
    legacyProject({ id: 'context', paperId: fixturePaper.id, pdfAssetId: 'pdf', checkpoint: 'paper-ready' }),
    'main.pdf',
  );
  const documentId = paper.documents[0].id;
  paper.blocks = Array.from({ length: 9 }, (_, index) => ({
    id: `block-${index}`,
    documentId,
    pageNumber: Math.floor(index / 3) + 1,
    kind: 'paragraph' as const,
    text: `完整段落 ${index}：保留剂量、限定和来源。`,
  }));
  paper.sources = paper.blocks.map((block) => ({
    id: `source-${block.id}`,
    documentId,
    pageNumber: block.pageNumber,
    kind: 'text',
    textQuote: block.text,
    textSpan: { blockId: block.id, start: 0, end: block.text.length },
  }));
  return paper;
}

it('容量允许时加入相邻页全部完整块，包括短段落，容量不足不裁剪当前页', () => {
  const paper = contextPaper();
  const before = structuredClone(paper);
  const target = { documentId: paper.documents[0].id, pageNumber: 2 };
  const all = selectEvidenceContext(paper, target, () => true);
  expect(all.contextBefore).toEqual(paper.blocks.slice(0, 3));
  expect(all.contextAfter).toEqual(paper.blocks.slice(6));
  expect(all.sources).toHaveLength(9);
  const limited = selectEvidenceContext(paper, target, (context) => context.sources.length <= 4);
  expect(limited.blocks).toEqual(paper.blocks.slice(3, 6));
  expect(limited.contextBefore).toEqual([paper.blocks[2]]);
  expect(limited.sources).toHaveLength(4);
  expect(paper).toEqual(before);
});

it('旧版已保存单元仍可续跑，新单元按完整语境校验基准', () => {
  const paper = contextPaper();
  const target = { kind: 'page' as const, documentId: paper.documents[0].id, pageNumber: 2 };
  paper.analysisUnits = [
    {
      id: unitId('evidence', target),
      stage: 'evidence',
      target,
      inputKey: JSON.stringify(['evidence-context-v2', getEvidenceContext(paper, target, true)]),
      outcome: 'completed',
      completedAt: 1,
    },
  ];
  expect(unitComplete(paper, 'evidence', target)).toBe(true);
  paper.analysisUnits[0].inputKey = getUnitInputKey(paper, 'evidence', target);
  expect(unitComplete(paper, 'evidence', target)).toBe(true);
  paper.blocks[0].text += '来源变化';
  expect(unitComplete(paper, 'evidence', target)).toBe(false);
});
