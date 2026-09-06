import { describe, expect, it } from 'vitest';
import { fixtureDeck, fixturePaper } from '../fixtures';
import { validateAiCandidate } from '../../src/modules/assistant/revision/validateRevisionProposal';
import type { AiTarget } from '../../src/modules/assistant/target/resolveTarget';
import { narrativeDeck } from '../narrative-fixture';

const clone = <T>(value: T): T => structuredClone(value);
const bound: AiTarget = { slideIds: ['slide-1'], global: false, allowNewSlides: false };
const args = (mutations: unknown[], scope: unknown = { type: 'slides', slideIds: ['slide-1'] }) => ({
  scope,
  mutations,
  summary: '单元测试候选',
});

describe('AI 修改候选校验', () => {
  it('范围内合法修改通过并返回受影响页', async () => {
    const deck = narrativeDeck();
    deck.slides[0].id = 'slide-1';
    const { args: parsed, affectedSlideIds } = await validateAiCandidate(
      args([{ type: 'update-slide', slideId: 'slide-1', changes: { title: '新标题' } }]),
      bound,
      deck,
      fixturePaper,
    );
    expect(parsed.scope.type).toBe('slides');
    expect(affectedSlideIds).toEqual(['slide-1']);
  });

  it('叙事错误阻止提案且不改变原稿', async () => {
    const deck = narrativeDeck();
    const original = clone(deck);
    const slideId = deck.slides.find((slide) => slide.kind === 'result')!.id;
    await expect(
      validateAiCandidate(
        args([{ type: 'update-slide', slideId, changes: { claimIds: [] } }], { type: 'slides', slideIds: [slideId] }),
        { slideIds: [slideId], global: false, allowNewSlides: false },
        deck,
        fixturePaper,
      ),
    ).rejects.toMatchObject({ code: 'narrative-invalid', stage: 'assistant' });
    expect(deck).toEqual(original);
  });

  it('章节范围拒绝跨章移动和跨章新增', async () => {
    const deck = narrativeDeck();
    const slide = deck.slides.find((slide) => slide.kind === 'result')!;
    const slideIds = deck.slides.filter((item) => item.sectionId === slide.sectionId).map((item) => item.id);
    const target: AiTarget = { slideIds, sectionId: slide.sectionId, global: false, allowNewSlides: true };
    for (const mutation of [
      { type: 'move-slide', slideId: slide.id, targetSectionId: deck.sections[0].id, afterSlideId: null },
      { type: 'add-slide', slide: { ...slide, id: 'new-slide', sectionId: deck.sections[0].id }, afterSlideId: null },
    ]) {
      await expect(
        validateAiCandidate(args([mutation], { type: 'slides', slideIds }), target, deck, fixturePaper),
      ).rejects.toMatchObject({ code: 'section-scope' });
    }
  });

  it('超出绑定范围的页拒绝', async () => {
    await expect(
      validateAiCandidate(
        args([{ type: 'update-slide', slideId: 'slide-2', changes: { title: '越界' } }]),
        bound,
        clone(fixtureDeck),
        fixturePaper,
      ),
    ).rejects.toThrow('修改超出本次请求绑定的页面范围');
  });

  it('局部请求不能修改整套语言', async () => {
    await expect(
      validateAiCandidate(args([{ type: 'set-language', language: 'en-US' }]), bound, clone(fixtureDeck), fixturePaper),
    ).rejects.toThrow('局部请求不能修改整套语言');
  });

  it('未绑定元素时 element 范围拒绝', async () => {
    await expect(
      validateAiCandidate(
        args([{ type: 'delete-element', slideId: 'slide-2', elementId: 'f1' }], {
          type: 'element',
          slideId: 'slide-2',
          elementId: 'f1',
        }),
        bound,
        clone(fixtureDeck),
        fixturePaper,
      ),
    ).rejects.toThrow('标题或页面修改必须使用包含目标页的 slides 范围');
  });

  it('Figure 请求改写其他内容拒绝', async () => {
    const figureTarget: AiTarget = { ...bound, slideIds: ['slide-2'], figureId: 'fig-3' };
    await expect(
      validateAiCandidate(
        args([{ type: 'replace-element', slideId: 'slide-2', element: { id: 'b1', type: 'text', text: '改文字' } }], {
          type: 'slides',
          slideIds: ['slide-2'],
        }),
        figureTarget,
        clone(fixtureDeck),
        fixturePaper,
      ),
    ).rejects.toThrow('Figure 请求不能改写其他内容');
  });

  it('非法 mutation 在内存模拟中被校验拒绝', async () => {
    await expect(
      validateAiCandidate(
        args([{ type: 'add-slide', slide: fixtureDeck.slides[0], afterSlideId: null }], { type: 'deck' }),
        { slideIds: fixtureDeck.slides.map((slide) => slide.id), global: true, allowNewSlides: true },
        clone(fixtureDeck),
        fixturePaper,
      ),
    ).rejects.toThrow();
  });
});
