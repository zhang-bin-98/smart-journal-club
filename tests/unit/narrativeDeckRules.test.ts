import { describe, expect, it } from 'vitest';
import { narrativeDeck, narrativePaper, paperWithoutDesign } from '../narrative-fixture';
import { validateDeckNarrative } from '../../src/modules/outline/validateNarrative';
import type { NarrativeIssue } from '../../src/modules/outline/narrativeRules';
import type { Deck } from '../../src/modules/deck/deck.schema';

const clone = <T>(value: T): T => structuredClone(value);
const validate = (deck: Deck, paper = narrativePaper()) => validateDeckNarrative(deck, paper);
const codes = (issues: NarrativeIssue[]) => issues.map((item) => item.code);
const findIssue = (issues: NarrativeIssue[], code: string) => issues.find((item) => item.code === code)!;
const slide = (deck: Deck, id: string) => deck.slides.find((item) => item.id === id)!;
const section = (deck: Deck, id: string) => deck.sections.find((item) => item.id === id)!;

describe('Deck 叙事校验', () => {
  it('合法基础文稿无 error 无 warning，且不要求页面 purpose', () => {
    const result = validate(narrativeDeck());
    expect(result).toEqual({ errors: [], warnings: [] });
    expect(codes(result.errors)).not.toContain('result-purpose-required');
  });

  it('零页文稿报 empty-plan', () => {
    const deck = narrativeDeck();
    deck.slides = [];
    deck.sections = [];
    expect(codes(validate(deck).errors)).toEqual(['empty-plan']);
  });

  it('内容页缺 take-home 报 content-message-required，旧稿缺 message 可被定位', () => {
    const deck = narrativeDeck();
    delete slide(deck, 'n-slide-synthesis').message;
    const issue = findIssue(validate(deck).errors, 'content-message-required');
    expect(issue.slideId).toBe('n-slide-synthesis');
  });

  it('引用不存在的图报 unknown-figure，证据来源未覆盖报 claim-evidence-source-mismatch', () => {
    const deck = narrativeDeck();
    const figure = slide(deck, 'n-slide-result-1').elements[0];
    if (figure?.type !== 'figure') throw new Error('fixture 布局不符合预期');
    figure.figureId = 'fig-ghost';
    expect(findIssue(validate(deck).errors, 'unknown-figure').slideId).toBe('n-slide-result-1');

    const evidence = narrativeDeck();
    slide(evidence, 'n-slide-result-2').sourceIds = [];
    const issue = findIssue(validate(evidence).errors, 'claim-evidence-source-mismatch');
    expect(issue.slideId).toBe('n-slide-result-2');
    expect(issue.claimId).toBe('claim-fixture');
  });

  it('四个 Panel 的合法页仅提示 many-panels，五个图超出布局容量报错', () => {
    const panels = narrativeDeck();
    const result = slide(panels, 'n-slide-result-1');
    result.layoutId = 'panel-grid';
    result.elements = [1, 2, 3, 4].map((index) => ({
      id: `${result.id}-panel-${index}`,
      type: 'figure' as const,
      figureId: 'fig-3',
      panelId: 'fig-3-panel-a',
    }));
    const panelResult = validate(panels);
    expect(panelResult.errors).toEqual([]);
    expect(findIssue(panelResult.warnings, 'many-panels').slideId).toBe('n-slide-result-1');

    const overflow = narrativeDeck();
    const overflowSlide = slide(overflow, 'n-slide-result-1');
    overflowSlide.layoutId = 'panel-grid';
    overflowSlide.elements = [1, 2, 3, 4, 5].map((index) => ({
      id: `${overflowSlide.id}-panel-${index}`,
      type: 'figure' as const,
      figureId: 'fig-3',
      panelId: 'fig-3-panel-a',
    }));
    expect(codes(validate(overflow).errors)).toEqual(['invalid-layout-figure-count']);
    expect(codes(validate(overflow).warnings)).not.toContain('many-panels');
  });

  it('同章页面不连续在 Deck 侧同样报 noncontiguous-section-slides', () => {
    const deck = narrativeDeck();
    const result = deck.slides.splice(4, 1)[0];
    deck.slides.splice(1, 0, result);
    expect(findIssue(validate(deck).errors, 'noncontiguous-section-slides').sectionId).toBe('n-sec-results');
  });

  it('论文无设计事实时 Deck 不要求设计职责', () => {
    const deck = narrativeDeck();
    const index = deck.sections.findIndex((item) => item.id === 'n-sec-study-design');
    deck.sections.splice(index, 1);
    deck.slides = deck.slides.filter((item) => item.id !== 'n-slide-method');
    const result = validate(deck, paperWithoutDesign());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('同一非法文稿两次校验结果完全一致', () => {
    const deck = narrativeDeck();
    delete slide(deck, 'n-slide-synthesis').message;
    slide(deck, 'n-slide-result-3').title = '结果';
    section(deck, 'n-sec-opening').transitionToNext = '';
    const first = validateDeckNarrative(clone(deck), narrativePaper());
    const second = validateDeckNarrative(clone(deck), narrativePaper());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.errors.length + first.warnings.length).toBeGreaterThanOrEqual(3);
  });
});
