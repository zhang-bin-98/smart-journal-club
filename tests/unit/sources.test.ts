import { describe, expect, it } from 'vitest';
import { fixturePaper, fixtureSource } from '../fixtures';
import { sourceIdsExcludingPages, sourceText } from '../../src/modules/paper/sources';

describe('来源页标注', () => {
  it('自动页脚排除 Citation 已覆盖的页并保留其他页', () => {
    const paper = structuredClone(fixturePaper);
    paper.pages.push({ pageNumber: 2, width: 800, height: 600, text: '第二页' });
    paper.sources.push({
      id: 'source-page-2',
      kind: 'text',
      pageNumber: 2,
    });
    const visible = sourceIdsExcludingPages(paper, [fixtureSource.id, 'source-page-2'], [fixtureSource.id]);
    expect(visible).toEqual(['source-page-2']);
    expect(sourceText(paper, visible)).toBe('论文第 2 页');
  });
});
