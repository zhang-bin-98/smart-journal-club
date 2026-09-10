import { describe, expect, it } from 'vitest';
import { migratePaperV1, migrateProjectV1, toLegacyPaper } from '../../src/modules/paper/migration';
import { validatePaper } from '../../src/modules/paper/model';
import { fixturePaper } from '../fixtures';
import { legacyProject } from '../legacy-fixtures';

const project = legacyProject({
  id: 'project-m15',
  paperId: fixturePaper.id,
  pdfAssetId: 'asset-m15',
  checkpoint: 'paper-ready',
});

describe('M15 论文迁移与聚合约束', () => {
  it('稳定迁移文件/全文/图块，保留原科学内容且不伪造完成或精确来源', () => {
    const paper = migratePaperV1(fixturePaper, project, 'paper.pdf');
    expect(migratePaperV1(paper, project, 'paper.pdf')).toEqual(paper);
    expect(migrateProjectV1(migrateProjectV1(project))).toEqual(migrateProjectV1(project));
    expect(paper.documents[0]).toMatchObject({ role: 'primary', pdfAssetId: project.pdfAssetId });
    expect(paper.blocks[0].text).toBe(fixturePaper.pages[0].text);
    expect(paper.analysisUnits).toEqual([]);
    expect(paper.figureReview.confirmedRevision).toBeUndefined();
    expect(paper.sources[0].textSpan).toBeUndefined();
    expect(paper.figures[0].regions[0].panels[0].id).toBe(fixturePaper.figures[0].panels[0].id);
    expect(toLegacyPaper(paper)).toEqual(fixturePaper);
  });

  it('相同页码允许分文件，拒绝跨文件原句、重复身份与孤立原文块', () => {
    const paper = migratePaperV1(fixturePaper, project, 'paper.pdf');
    paper.documents.push({
      id: 'supplement',
      role: 'supplement',
      fileName: 'supplement.pdf',
      pdfAssetId: 'asset-supplement',
    });
    paper.pages.push({
      documentId: 'supplement',
      pageNumber: 1,
      width: 800,
      height: 600,
      blockIds: ['supplement-block'],
    });
    paper.blocks.push({
      id: 'supplement-block',
      documentId: 'supplement',
      pageNumber: 1,
      kind: 'paragraph',
      text: 'Independent evidence.',
    });
    expect(validatePaper(paper).pages).toHaveLength(2);
    const invalid = structuredClone(paper);
    invalid.sources[0].textSpan = { blockId: 'supplement-block', start: 0, end: 11 };
    expect(() => validatePaper(invalid)).toThrow('原句定位区间无效');
    const duplicate = structuredClone(paper);
    duplicate.sources.push(duplicate.sources[0]);
    expect(() => validatePaper(duplicate)).toThrow('重复身份');
    paper.pages[1].blockIds = [];
    expect(() => validatePaper(paper)).toThrow('原文块缺少所属页面');
  });

  it('未知版本和损坏引用失败时不修改传入数据', () => {
    const original = structuredClone(fixturePaper);
    expect(() => migratePaperV1({ ...original, schemaVersion: 99 }, project, 'paper.pdf')).toThrow();
    expect(fixturePaper).toEqual(original);
    const paper = migratePaperV1(fixturePaper, project, 'paper.pdf');
    paper.claims[0].evidenceIds.push('missing');
    expect(() => validatePaper(paper)).toThrow('发现引用不存在的证据');
  });
});
