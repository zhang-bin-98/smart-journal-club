import { describe, expect, it } from 'vitest';
import { fixtureDeck, fixturePaper } from '../fixtures';
import { validateAiCandidate } from '../../src/modules/assistant/revision/validateRevisionProposal';
import type { AiTarget } from '../../src/modules/assistant/target/resolveTarget';

const clone = <T>(value: T): T => structuredClone(value);
const bound: AiTarget = { slideIds: ['slide-1'], global: false, allowNewSlides: false };
const args = (mutations: unknown[], scope: unknown = { type: 'slides', slideIds: ['slide-1'] }) => ({
  scope,
  mutations,
  summary: '单元测试候选',
});

describe('AI 修改候选校验', () => {
  it('范围内合法修改通过并返回受影响页', async () => {
    const { args: parsed, affectedSlideIds } = await validateAiCandidate(
      args([{ type: 'update-slide', slideId: 'slide-1', changes: { title: '新标题' } }]),
      bound,
      clone(fixtureDeck),
      fixturePaper,
    );
    expect(parsed.scope.type).toBe('slides');
    expect(affectedSlideIds).toEqual(['slide-1']);
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
        args([{ type: 'delete-element', slideId: 'slide-2', elementId: 'f1' }], { type: 'element', slideId: 'slide-2', elementId: 'f1' }),
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
