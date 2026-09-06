import { describe, expect, it } from 'vitest';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
import { assembleDeck } from '../../src/modules/generation/buildDeck';
import { validateBuiltDeckAgainstPlan } from '../../src/modules/generation/validateBuiltDeckAgainstPlan';

describe('build contract', () => {
  it('合法构建结果通过且逐字段失配可定位', () => {
    const plan = narrativePlan('confirmed');
    const deck = assembleDeck(
      plan,
      {
        slides: plan.slides.map((slide) => ({
          id: slide.id,
          elements: slide.figures.map((figure, index) => ({ id: `element-${index}`, type: 'figure', ...figure })),
        })),
      },
      narrativePaper(),
    );
    expect(validateBuiltDeckAgainstPlan(deck, plan)).toEqual([]);
    deck.slides[0].layoutId = 'text-only';
    expect(validateBuiltDeckAgainstPlan(deck, plan)).toContain('页面结构不一致：n-slide-title');
    expect(validateBuiltDeckAgainstPlan({ ...deck, slides: deck.slides.slice(1) }, plan)).toContain(
      '生成页数与确认计划不一致',
    );
    expect(validateBuiltDeckAgainstPlan(deck, { ...plan, status: 'draft' })).toContain('只有已确认计划可以构建');
    expect(narrativePaper().id).toBe(plan.paperId);
  });
});
