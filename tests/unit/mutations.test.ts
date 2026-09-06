import { describe, expect, it } from 'vitest';
import { fixtureDeck } from '../fixtures';
import { applyMutation, createSlide } from '../../src/modules/deck/mutations';
import type { DeckMutation } from '../../src/modules/deck/deck.schema';

const clone = <T>(value: T): T => structuredClone(value);
const apply = (deck: typeof fixtureDeck, mutation: DeckMutation) => applyMutation(deck, mutation);

describe('applyMutation 基础行为', () => {
  it('新增页插入到指定锚点之后', () => {
    const deck = clone(fixtureDeck);
    const slide = createSlide('slide-new', 4);
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
    expect(() => apply(deck, { type: 'move-slide', slideId: 'slide-1', afterSlideId: 'slide-1' })).toThrow('不能移动到自身之后');
  });

  it('页移动按锚点重排', () => {
    const deck = clone(fixtureDeck);
    apply(deck, { type: 'move-slide', slideId: 'slide-3', afterSlideId: 'slide-1' });
    expect(deck.slides.map((item) => item.id)).toEqual(['slide-1', 'slide-3', 'slide-2']);
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
});
