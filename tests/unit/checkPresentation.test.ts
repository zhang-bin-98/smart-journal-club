import { describe, expect, it } from 'vitest';
import {
  checkPresentation,
  locatePresentationIssue,
  presentationVersion,
} from '../../src/app/presentation/checkPresentation';
import { narrativeDeck, narrativePaper } from '../narrative-fixture';

describe('检查与导出', () => {
  it('统一版本键并保留叙事问题的页面定位', () => {
    const deck = narrativeDeck();
    deck.slides.find((slide) => slide.kind === 'result')!.title = '结果';
    const check = checkPresentation(deck, narrativePaper(), true);
    const issue = check.warnings.find((item) => item.code === 'generic-result-title')!;
    expect(check.version).toBe(presentationVersion(deck));
    expect(locatePresentationIssue(deck, issue)).toMatchObject({
      slideId: issue.slideId,
      inspectorTab: 'content',
    });
  });

  it('含图文稿缺 PDF 是硬错误，纯文字文稿只提示警告', () => {
    const deck = narrativeDeck();
    expect(checkPresentation(deck, narrativePaper(), false).errors.map((item) => item.code)).toContain(
      'pdf-unavailable',
    );
    for (const slide of deck.slides) slide.elements = slide.elements.filter((element) => element.type !== 'figure');
    const check = checkPresentation(deck, narrativePaper(), false);
    expect(check.errors.map((item) => item.code)).not.toContain('pdf-unavailable');
    expect(check.warnings.map((item) => item.code)).toContain('pdf-unavailable');
  });

  it('汇总视觉警告和人工科学复核提醒', () => {
    const deck = narrativeDeck();
    const result = deck.slides.find((slide) => slide.kind === 'result')!;
    result.title = '很长的结论'.repeat(14);
    result.layoutId = 'panel-grid';
    result.elements = [1, 2, 3, 4].map((index) => ({
      id: `figure-${index}`,
      type: 'figure' as const,
      figureId: 'fig-3',
      panelId: 'fig-3-panel-a',
    }));
    const check = checkPresentation(deck, narrativePaper(), true);
    expect(check.warnings.map((item) => item.code)).toEqual(expect.arrayContaining(['title-long', 'figure-small']));
    expect(check.reviews.map((item) => item.code)).toEqual(
      expect.arrayContaining(['review-causality', 'review-population', 'review-endpoint']),
    );
  });
});
