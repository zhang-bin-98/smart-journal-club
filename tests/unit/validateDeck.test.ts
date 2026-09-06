import { describe, expect, it } from 'vitest';
import { fixturePaper } from '../fixtures';
import { layoutCapacity } from '../../src/modules/deck/layoutRules';
import { validateDeck } from '../../src/modules/deck/validateDeck';
import { validatePlan } from '../../src/modules/outline/validatePlan';
import type { DeckPlan, PlannedSection, PlannedSlide } from '../../src/modules/outline/outline.schema';
import type { DeckSection, Slide } from '../../src/modules/deck/deck.schema';

const section = (id: string, overrides: Partial<DeckSection> = {}): DeckSection => ({
  id,
  kind: 'custom',
  title: `章节 ${id}`,
  purpose: '',
  ...overrides,
});
const slide = (id: string, overrides: Partial<Slide> = {}): Slide => ({
  id,
  sectionId: 'sec-1',
  kind: 'custom',
  title: `页 ${id}`,
  layoutId: 'text-only',
  elements: [],
  claimIds: [],
  sourceIds: [],
  ...overrides,
});
const deck = (sections: DeckSection[], slides: Slide[]) => ({
  schemaVersion: 2 as const,
  id: 'deck',
  paperId: fixturePaper.id,
  revision: 0,
  title: 't',
  language: 'zh-CN',
  sections,
  slides,
  createdAt: 0,
  updatedAt: 0,
});
const plannedSection = (id: string, overrides: Partial<PlannedSection> = {}): PlannedSection => ({
  ...section(id),
  slideBudget: 1,
  ...overrides,
});
const plannedSlide = (id: string, overrides: Partial<PlannedSlide> = {}): PlannedSlide => ({
  id,
  sectionId: 'sec-1',
  kind: 'custom',
  title: `页 ${id}`,
  purpose: '',
  message: '',
  layoutId: 'text-only',
  claimIds: [],
  sourceIds: [],
  figures: [],
  ...overrides,
});
const plan = (sections: PlannedSection[], slides: PlannedSlide[]): DeckPlan => ({
  schemaVersion: 2,
  id: 'plan',
  paperId: fixturePaper.id,
  title: '单元测试计划',
  language: 'zh-CN',
  status: 'draft',
  revision: 0,
  sections,
  slides,
  claimEmphasis: [],
  createdAt: 0,
  updatedAt: 0,
});

describe('布局容量', () => {
  it('六类布局按元素构成判定', () => {
    const text = { id: 'e', type: 'text', text: '' } as const;
    const figure = { id: 'f', type: 'figure', figureId: 'fig-3' } as const;
    expect(layoutCapacity({ ...slide('s'), layoutId: 'title', elements: [{ ...text }] })).toBe(true);
    expect(layoutCapacity({ ...slide('s'), layoutId: 'title', elements: [{ ...figure }] })).toBe(false);
    expect(
      layoutCapacity({
        ...slide('s'),
        layoutId: 'text-only',
        elements: [1, 2, 3, 4].map((n) => ({ ...text, id: `e${n}` })),
      }),
    ).toBe(true);
    expect(
      layoutCapacity({
        ...slide('s'),
        layoutId: 'text-only',
        elements: [1, 2, 3, 4, 5].map((n) => ({ ...text, id: `e${n}` })),
      }),
    ).toBe(false);
    expect(layoutCapacity({ ...slide('s'), layoutId: 'figure-full', elements: [{ ...figure }] })).toBe(true);
  });
});

describe('Deck v2 形状', () => {
  it('缺 sectionId、缺 sections、v1 版本号与未知字段均拒绝', () => {
    const valid = deck([section('sec-1')], [slide('s1')]);
    expect(validateDeck({ ...valid, slides: [{ ...slide('s1'), sectionId: undefined }] }, fixturePaper)[0]).toContain(
      'sectionId',
    );
    expect(validateDeck({ ...valid, sections: undefined }, fixturePaper)[0]).toContain('sections');
    expect(validateDeck({ ...valid, schemaVersion: 1 }, fixturePaper)[0]).toContain('schemaVersion');
    expect(validateDeck({ ...valid, extra: true }, fixturePaper)[0]).toContain('extra');
  });
});

describe('Deck 校验', () => {
  it('合法 Deck 无错误，允许多个 results 章节', () => {
    const value = deck(
      [
        section('sec-opening', { kind: 'opening' }),
        section('sec-results-1', { kind: 'results' }),
        section('sec-results-2', { kind: 'results' }),
        section('sec-takeaways', { kind: 'takeaways' }),
      ],
      [
        slide('s1', { sectionId: 'sec-opening' }),
        slide('s2', { sectionId: 'sec-results-1' }),
        slide('s3', { sectionId: 'sec-results-2' }),
        slide('s4', { sectionId: 'sec-takeaways' }),
      ],
    );
    expect(validateDeck(value, fixturePaper)).toEqual([]);
  });

  it('重复页 ID、缺失 Claim 与缺失来源均报错', () => {
    const value = deck(
      [section('sec-1')],
      [slide('s1'), slide('s1', { claimIds: ['missing'], sourceIds: ['missing-source'] })],
    );
    const errors = validateDeck(value, fixturePaper);
    expect(errors).toContain('重复 slide id');
    expect(errors.some((message) => message.includes('页结论不存在'))).toBe(true);
    expect(errors.some((message) => message.includes('页来源不存在'))).toBe(true);
  });

  it('页指向不存在的章节报错', () => {
    const errors = validateDeck(deck([section('sec-1')], [slide('s1', { sectionId: 'sec-missing' })]), fixturePaper);
    expect(errors).toContain('页章节不存在：s1');
  });

  it('重复 section id 报错', () => {
    const errors = validateDeck(deck([section('sec-1'), section('sec-1')], [slide('s1'), slide('s2')]), fixturePaper);
    expect(errors).toContain('重复 section id');
  });

  it('同章页面不连续报错', () => {
    const errors = validateDeck(
      deck([section('sec-1'), section('sec-2')], [slide('s1'), slide('s2', { sectionId: 'sec-2' }), slide('s3')]),
      fixturePaper,
    );
    expect(errors).toContain('章节页面不连续：sec-1');
  });

  it('sections 顺序与页面块顺序不一致报错', () => {
    const errors = validateDeck(
      deck([section('sec-2'), section('sec-1')], [slide('s1'), slide('s2', { sectionId: 'sec-2' })]),
      fixturePaper,
    );
    expect(errors).toContain('章节顺序与页面排列不一致');
  });

  it('runtime Deck 不允许空章节，零页文稿必须零章节', () => {
    const errors = validateDeck(deck([section('sec-1'), section('sec-2')], [slide('s1')]), fixturePaper);
    expect(errors).toContain('空章节：sec-2');
    expect(validateDeck(deck([], []), fixturePaper)).toEqual([]);
  });
});

describe('v2 计划校验', () => {
  it('合法计划通过并原样返回', () => {
    const value = plan(
      [plannedSection('sec-1', { kind: 'opening' }), plannedSection('sec-2', { kind: 'results', slideBudget: 2 })],
      [
        plannedSlide('p1', { sectionId: 'sec-1', kind: 'title', layoutId: 'title' }),
        plannedSlide('p2', {
          sectionId: 'sec-2',
          kind: 'result',
          layoutId: 'figure-full',
          figures: [{ figureId: 'fig-3' }],
        }),
      ],
    );
    expect(validatePlan(value, fixturePaper)).toEqual(value);
  });

  it('引用不存在图源或章节的计划拒绝', () => {
    expect(() =>
      validatePlan(
        plan(
          [plannedSection('sec-1')],
          [
            plannedSlide('p1', {
              sectionId: 'sec-missing',
              kind: 'result',
              layoutId: 'figure-full',
              figures: [{ figureId: 'missing' }],
            }),
          ],
        ),
        fixturePaper,
      ),
    ).toThrow('汇报计划无效');
  });
});
