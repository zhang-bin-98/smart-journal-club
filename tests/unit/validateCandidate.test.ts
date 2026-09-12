import { describe, expect, it, vi } from 'vitest';
import { createSlidesAssistant } from '../../src/app/assistant/slidesAssistant';
import { DeckSession } from '../../src/app/presentation/DeckSession';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { slidesFixture } from '../speech-fixture';
import type { ApplyRevisionArgs } from '../../src/modules/presentation/editing/schema';

function setup() {
  const { deck, state } = slidesFixture();
  const persist = vi.fn(async () => {});
  const session = new DeckSession(deck, state.paper, persist);
  const args: ApplyRevisionArgs = {
    scope: { type: 'slides', slideIds: ['slide-0'] },
    mutations: [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '候选标题' } }],
    summary: '修改标题',
  };
  const run = (candidate = args, action?: () => Promise<void> | void) =>
    createSlidesAssistant(async ({ tools }) => {
      tools[0].execute(candidate);
      await action?.();
      return '请预览';
    })({
      session,
      paper: state.paper,
      settings: DEFAULT_SETTINGS,
      question: '调整本页',
      mode: 'edit',
      slideIds: ['slide-0'],
      signal: new AbortController().signal,
      onText: () => {},
    });
  return { deck, session, persist, args, run };
}
describe('正式幻灯片 AI 候选校验', () => {
  it('预览不保存；应用同批只推进一次版本和 Undo', async () => {
    const { session, persist, args, run } = setup();
    const original = structuredClone(session.current);
    const { proposal } = await run();
    expect(proposal?.preview.slides[0].title).toBe('候选标题');
    expect(session.current).toEqual(original);
    expect(persist).not.toHaveBeenCalled();
    expect(session.canUndo).toBe(false);
    session.assertCapture(proposal!.capture);
    await session.commit(args.scope, args.mutations, args.summary);
    expect(persist).toHaveBeenCalledOnce();
    expect(session.current.revision).toBe(original.revision + 1);
    expect(() => session.assertCapture(proposal!.capture)).toThrow('变化');
    await session.undo();
    expect(session.current.slides).toEqual(original.slides);
  });
  it('越界页、元素、语言、讲稿与插入锚点均拒绝', async () => {
    const { run, args } = setup();
    const changes: ApplyRevisionArgs[] = [
      { ...args, mutations: [{ type: 'update-slide', slideId: 'slide-1', changes: { title: '越界' } }] },
      { ...args, scope: { type: 'element', slideId: 'slide-1', elementId: 'image-1' } },
      { ...args, mutations: [{ type: 'set-language', language: 'en-US' }] },
      { ...args, mutations: [{ type: 'update-slide', slideId: 'slide-0', changes: { speechIds: ['segment-b'] } }] },
      {
        ...args,
        mutations: [{ type: 'move-slide', slideId: 'slide-0', targetSectionId: 'chapter-a', afterSlideId: 'slide-1' }],
      },
    ];
    for (const candidate of changes) await expect(run(candidate)).rejects.toThrow();
  });
  it('合法修改后出现非法项，整份候选拒绝且原稿不变', async () => {
    const { session, args, run, persist } = setup();
    const before = structuredClone(session.current);
    await expect(
      run({
        ...args,
        mutations: [
          ...args.mutations,
          { type: 'update-slide', slideId: 'slide-0', changes: { sourceIds: ['missing-source'] } },
        ],
      }),
    ).rejects.toThrow();
    expect(session.current).toEqual(before);
    expect(persist).not.toHaveBeenCalled();
  });
  it('迟到答复被版本变更、已保存过的输入和未保存草稿拒绝', async () => {
    for (const mode of ['commit', 'saved-draft', 'dirty']) {
      const { session, args, run } = setup();
      await expect(
        run(args, async () => {
          if (mode === 'commit') await session.commit(args.scope, args.mutations, '人工修改');
          else {
            const version = session.registerDraft();
            if (mode === 'saved-draft') session.releaseDraft(version);
          }
        }),
      ).rejects.toThrow('变化');
    }
  });
  it('保存失败不推进会话、版本或 Undo', async () => {
    const { session, persist, args, run } = setup();
    const { proposal } = await run();
    const before = structuredClone(session.current);
    persist.mockRejectedValueOnce(new Error('固定保存失败'));
    await expect(session.commit(args.scope, args.mutations, args.summary)).rejects.toThrow('保存失败');
    expect(session.current).toEqual(before);
    expect(session.canUndo).toBe(false);
    expect(() => session.assertCapture(proposal!.capture)).not.toThrow();
  });
});
