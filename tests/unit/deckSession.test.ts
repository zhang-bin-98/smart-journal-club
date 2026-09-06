import { describe, expect, it } from 'vitest';
import { fixtureDeck, fixturePaper } from '../fixtures';
import { DeckSession } from '../../src/modules/deck/DeckSession';
import type { ApplyRevisionArgs } from '../../src/modules/deck/deck.schema';

const clone = <T>(value: T): T => structuredClone(value);
const session = () => new DeckSession(clone(fixtureDeck), fixturePaper);
const renameFirst = (value: string): ApplyRevisionArgs => ({
  scope: { type: 'slides', slideIds: ['slide-1'] },
  mutations: [{ type: 'update-slide', slideId: 'slide-1', changes: { title: value } }],
  summary: '单元测试修改',
});

describe('DeckSession 内存会话语义', () => {
  it('提交推进 revision 并支持一次 Undo/Redo', async () => {
    const current = session();
    await current.commit(renameFirst('新标题').scope, renameFirst('新标题').mutations, '编辑');
    expect(current.current.revision).toBe(1);
    expect(current.current.slides[0].title).toBe('新标题');
    await current.undo();
    expect(current.current.revision).toBe(2);
    expect(current.current.slides[0].title).toBe(fixtureDeck.slides[0].title);
    await current.redo();
    expect(current.current.revision).toBe(3);
    expect(current.current.slides[0].title).toBe('新标题');
  });

  it('绑定旧基准版本的 AI 候选不得提交', async () => {
    const current = session();
    const request = { requestId: 'req-stale', projectId: '', deckId: current.current.id, baseRevision: 5 };
    await expect(current.applyRevision(request, renameFirst('过期'))).rejects.toThrow('修改请求目标或版本已变化');
    expect(current.current.revision).toBe(0);
  });

  it('重复 requestId 不得重复提交', async () => {
    const current = session();
    const request = { requestId: 'req-dup', projectId: '', deckId: current.current.id, baseRevision: 0 };
    await current.applyRevision(request, renameFirst('第一次'));
    const retry = { ...request, baseRevision: current.current.revision };
    await expect(current.applyRevision(retry, renameFirst('第二次'))).rejects.toThrow('本次修改已经提交');
  });

  it('scope 含不存在的页时拒绝', async () => {
    const current = session();
    const changes: ApplyRevisionArgs = { ...renameFirst('越界'), scope: { type: 'slides', slideIds: ['missing'] } };
    await expect(current.commit(changes.scope, changes.mutations, '越界')).rejects.toThrow(
      '修改范围含有重复或不存在的页',
    );
  });

  it('局部请求不能修改整套语言', async () => {
    const current = session();
    await expect(
      current.commit(renameFirst('x').scope, [{ type: 'set-language', language: 'en-US' }], '切换语言'),
    ).rejects.toThrow('语言修改必须使用 deck 范围');
  });

  it('非法修改不改变 Current', async () => {
    const current = session();
    await expect(
      current.commit(
        { type: 'deck' },
        [{ type: 'add-slide', slide: fixtureDeck.slides[0], afterSlideId: null }],
        '重复 ID',
      ),
    ).rejects.toThrow();
    expect(current.current.revision).toBe(0);
    expect(current.current.slides).toHaveLength(fixtureDeck.slides.length);
  });
});
