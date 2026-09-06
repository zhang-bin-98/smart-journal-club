import { describe, expect, it } from 'vitest';
import { fixturePaper } from '../fixtures';
import { layoutCapacity } from '../../src/modules/deck/layoutRules';
import { validateDeck } from '../../src/modules/deck/validateDeck';
import { validatePlan } from '../../src/modules/outline/validatePlan';
import type { DeckPlan } from '../../src/modules/outline/outline.schema';
import type { Slide } from '../../src/modules/deck/deck.schema';

const slide = (id: string, overrides: Partial<Slide> = {}): Slide => ({
  id,
  kind: 'custom',
  title: `页 ${id}`,
  layoutId: 'text-only',
  elements: [],
  claimIds: [],
  sourceIds: [],
  ...overrides,
});
const plan = (slides: DeckPlan['slides']): DeckPlan => ({
  schemaVersion: 1,
  paperId: fixturePaper.id,
  title: '单元测试计划',
  language: 'zh-CN',
  slides,
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

describe('Deck 校验', () => {
  it('合法 Deck 无错误', () => {
    const deck = {
      schemaVersion: 1,
      id: 'deck',
      paperId: fixturePaper.id,
      revision: 0,
      title: 't',
      language: 'zh-CN',
      slides: [slide('s1'), slide('s2')],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(validateDeck(deck, fixturePaper)).toEqual([]);
  });

  it('重复页 ID、缺失 Claim 与缺失来源均报错', () => {
    const deck = {
      schemaVersion: 1,
      id: 'deck',
      paperId: fixturePaper.id,
      revision: 0,
      title: 't',
      language: 'zh-CN',
      slides: [slide('s1'), slide('s1', { claimIds: ['missing'], sourceIds: ['missing-source'] })],
      createdAt: 0,
      updatedAt: 0,
    };
    const errors = validateDeck(deck, fixturePaper);
    expect(errors).toContain('重复 slide id');
    expect(errors.some((message) => message.includes('页结论不存在'))).toBe(true);
    expect(errors.some((message) => message.includes('页来源不存在'))).toBe(true);
  });
});

describe('v1 计划校验', () => {
  it('合法计划通过并原样返回', () => {
    const value = plan([
      { id: 'p1', kind: 'title', title: '标题页', layoutId: 'title', claimIds: [], sourceIds: [], figures: [] },
      {
        id: 'p2',
        kind: 'result',
        title: '结果页',
        layoutId: 'figure-full',
        claimIds: [],
        sourceIds: [],
        figures: [{ figureId: 'fig-3' }],
      },
    ]);
    expect(validatePlan(value, fixturePaper)).toEqual(value);
  });

  it('引用不存在图源的计划拒绝', () => {
    expect(() =>
      validatePlan(
        plan([
          {
            id: 'p1',
            kind: 'result',
            title: '结果页',
            layoutId: 'figure-full',
            claimIds: [],
            sourceIds: [],
            figures: [{ figureId: 'missing' }],
          },
        ]),
        fixturePaper,
      ),
    ).toThrow('汇报计划无效');
  });
});
