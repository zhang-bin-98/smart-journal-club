import { describe, expect, it } from 'vitest';
import { fixtureDeck } from '../fixtures';
import { applyMutation, createSlide } from '../../src/modules/deck/mutations';
import type { DeckMutation } from '../../src/modules/deck/deck.schema';

const clone = <T>(value: T): T => structuredClone(value);
const apply = (deck: typeof fixtureDeck, mutation: DeckMutation) => applyMutation(deck, mutation);
const sectionIds = (deck: typeof fixtureDeck) => deck.sections.map((section) => section.id);

describe('applyMutation 基础行为', () => {
  it('新增页插入到指定锚点之后', () => {
    const deck = clone(fixtureDeck);
    const slide = createSlide('slide-new', 4, 'sec-opening');
    const { affected } = apply(deck, { type: 'add-slide', slide, afterSlideId: 'slide-1' });
    expect(affected).toEqual(['slide-new']);
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-1', 'slide-new', 'slide-2', 'slide-3']);
  });

  it('重复幻灯片 ID 拒绝新增', () => {
    const deck = clone(fixtureDeck);
    expect(() => apply(deck, { type: 'add-slide', slide: createSlide('slide-1', 2), afterSlideId: null })).toThrow(
      '新增幻灯片 ID 已存在',
    );
  });

  it('删除不存在的页拒绝', () => {
    const deck = clone(fixtureDeck);
    expect(() => apply(deck, { type: 'delete-slide', slideId: 'missing' })).toThrow('删除目标不存在');
  });

  it('移动到自身之后拒绝', () => {
    const deck = clone(fixtureDeck);
    expect(() =>
      apply(deck, { type: 'move-slide', slideId: 'slide-1', targetSectionId: 'sec-opening', afterSlideId: 'slide-1' }),
    ).toThrow('不能移动到自身之后');
  });

  it('重复元素 ID 拒绝新增', () => {
    const deck = clone(fixtureDeck);
    expect(() =>
      apply(deck, { type: 'add-element', slideId: 'slide-1', element: { id: 't1', type: 'text', text: '重复' } }),
    ).toThrow('新增元素 ID 已存在');
  });

  it('更换 Figure 引用时清除旧裁图覆盖', () => {
    const deck = clone(fixtureDeck);
    const figure = deck.slides[1].elements.find((element) => element.id === 'f1');
    if (figure?.type !== 'figure') throw new Error('fixture 布局不符合预期');
    const next = { ...figure, panelId: 'fig-3-panel-a', cropOverride: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } };
    apply(deck, { type: 'replace-element', slideId: 'slide-2', element: next });
    const replaced = deck.slides[1].elements.find((element) => element.id === 'f1');
    expect(replaced && replaced.type === 'figure' ? replaced.cropOverride : undefined).toBeUndefined();
  });

  it('删除图元素后布局按剩余内容回退', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'delete-element', slideId: 'slide-2', elementId: 'f1' });
    const slide = deck.slides.find((item) => item.id === 'slide-2');
    expect(slide?.layoutId).toBe('text-only');
  });

  it('update-slide 直接改写 sectionId 被拒绝', () => {
    const deck = clone(fixtureDeck);
    expect(() =>
      apply(deck, {
        type: 'update-slide',
        slideId: 'slide-1',
        changes: { sectionId: 'sec-results' } as never,
      }),
    ).toThrow('页面章节归属不能直接修改');
  });
});

describe('applyMutation 章节 invariant', () => {
  it('空 Deck 新增页自动创建唯一 custom 章节并绑定', () => {
    const deck = clone(fixtureDeck);
    deck.sections = [];
    deck.slides = [];
    apply(deck, { type: 'add-slide', slide: createSlide('slide-first', 1), afterSlideId: null });
    expect(deck.sections).toHaveLength(1);
    expect(deck.sections[0].kind).toBe('custom');
    expect(deck.slides[0].sectionId).toBe(deck.sections[0].id);
  });

  it('新增页落在目标章节块首，锚点不属于目标章节拒绝', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'add-slide', slide: createSlide('slide-new', 4, 'sec-results'), afterSlideId: null });
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-1', 'slide-new', 'slide-2', 'slide-3']);
    expect(() =>
      apply(deck, { type: 'add-slide', slide: createSlide('slide-x', 5, 'sec-results'), afterSlideId: 'slide-3' }),
    ).toThrow('插入位置不属于目标章节');
  });

  it('新增页引用不存在的章节拒绝', () => {
    const deck = clone(fixtureDeck);
    expect(() =>
      apply(deck, { type: 'add-slide', slide: createSlide('slide-x', 4, 'sec-missing'), afterSlideId: null }),
    ).toThrow('新增页面章节不存在');
  });

  it('删除章内最后一页时同步移除空章节', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'delete-slide', slideId: 'slide-2' });
    expect(sectionIds(deck)).toEqual(['sec-opening', 'sec-takeaways']);
    expect(deck.slides.map((item) => item.sectionId)).toEqual(['sec-opening', 'sec-takeaways']);
  });

  it('删除非章内最后一页不影响章节', () => {
    const deck = clone(fixtureDeck);
    deck.slides.splice(2, 0, { ...clone(deck.slides[1]), id: 'slide-2b' });
    apply(deck, { type: 'delete-slide', slideId: 'slide-2' });
    expect(sectionIds(deck)).toEqual(['sec-opening', 'sec-results', 'sec-takeaways']);
  });

  it('同章移动保持归属并按锚点重排', () => {
    const deck = clone(fixtureDeck);
    deck.slides.splice(2, 0, { ...clone(deck.slides[1]), id: 'slide-2b' });
    apply(deck, { type: 'move-slide', slideId: 'slide-2', targetSectionId: 'sec-results', afterSlideId: 'slide-2b' });
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-1', 'slide-2b', 'slide-2', 'slide-3']);
    expect(deck.slides[2].sectionId).toBe('sec-results');
    expect(sectionIds(deck)).toEqual(['sec-opening', 'sec-results', 'sec-takeaways']);
  });

  it('跨章移动更新归属并清理空源章节', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'move-slide', slideId: 'slide-2', targetSectionId: 'sec-takeaways', afterSlideId: 'slide-3' });
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-1', 'slide-3', 'slide-2']);
    expect(deck.slides[2].sectionId).toBe('sec-takeaways');
    expect(sectionIds(deck)).toEqual(['sec-opening', 'sec-takeaways']);
  });

  it('跨章移动到目标章块首', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'move-slide', slideId: 'slide-3', targetSectionId: 'sec-opening', afterSlideId: null });
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-3', 'slide-1', 'slide-2']);
    expect(deck.slides[0].sectionId).toBe('sec-opening');
    expect(sectionIds(deck)).toEqual(['sec-opening', 'sec-results']);
  });

  it('目标章节不存在或锚点不属于目标章节拒绝', () => {
    const deck = clone(fixtureDeck);
    expect(() =>
      apply(deck, { type: 'move-slide', slideId: 'slide-1', targetSectionId: 'sec-missing', afterSlideId: null }),
    ).toThrow('目标章节不存在');
    expect(() =>
      apply(deck, { type: 'move-slide', slideId: 'slide-1', targetSectionId: 'sec-results', afterSlideId: 'slide-3' }),
    ).toThrow('插入位置不属于目标章节');
  });
});
