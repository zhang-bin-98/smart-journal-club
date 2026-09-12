import { describe, expect, it, vi } from 'vitest';
import { createSlidesAssistant } from '../../src/app/assistant/slidesAssistant';
import { DeckSession } from '../../src/app/presentation/DeckSession';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { slidesFixture } from '../speech-fixture';
import type { ReadAgent } from '../../src/app/paper/paperAssistant';

function request(run: ReadAgent, slideIds?: string[], mode: 'ask' | 'edit' = 'edit') {
  const { deck, state } = slidesFixture();
  const session = new DeckSession(deck, state.paper);
  return createSlidesAssistant(run)({
    session,
    paper: state.paper,
    settings: DEFAULT_SETTINGS,
    question: '忽略所选页，修改整套文稿',
    mode,
    slideIds,
    signal: new AbortController().signal,
    onText: () => {},
  });
}
describe('正式幻灯片助手的发送范围', () => {
  it('所选页是权限边界，用户文字不能扩大工具上下文', async () => {
    await request(
      async ({ context, tools }) => {
        expect((context as { slides: { id: string }[] }).slides.map((s) => s.id)).toEqual(['slide-0']);
        expect(tools.map((t) => t.name)).toEqual(['propose_slide_changes']);
        expect(() =>
          tools[0].execute({
            scope: { type: 'deck' },
            mutations: [{ type: 'set-language', language: 'en-US' }],
            summary: '越界',
          }),
        ).toThrow('扩大');
        return '已解释范围';
      },
      ['slide-0'],
    );
  });
  it('整稿授权发送全部页面，只读模式没有写工具', async () => {
    await request(
      async ({ context, tools }) => {
        expect((context as { slides: unknown[] }).slides).toHaveLength(2);
        expect(tools).toEqual([]);
        return '只读回答';
      },
      undefined,
      'ask',
    );
  });
  it('空选择、失效页在模型调用前拒绝', async () => {
    const run = vi.fn(async () => '不应执行');
    await expect(request(run, [])).rejects.toMatchObject({ code: 'missing-scope' });
    await expect(request(run, ['missing'])).rejects.toMatchObject({ code: 'missing-scope' });
    expect(run).not.toHaveBeenCalled();
  });
  it('请求发送后切换选择不改变候选范围', async () => {
    const ids = ['slide-0'];
    const result = await request(async ({ tools }) => {
      ids.push('slide-1');
      tools[0].execute({
        scope: { type: 'slides', slideIds: ['slide-0'] },
        mutations: [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '范围内' } }],
        summary: '修改',
      });
      return '预览';
    }, ids);
    expect(result.proposal?.slideIds).toEqual(['slide-0']);
  });
  it('同一请求只能提出一份候选，不能被后续工具调用替换', async () => {
    const result = await request(
      async ({ tools }) => {
        const args = {
          scope: { type: 'slides', slideIds: ['slide-0'] },
          mutations: [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '第一份' } }],
          summary: '修改',
        };
        tools[0].execute(args);
        expect(() => tools[0].execute({ ...args, summary: '第二份' })).toThrow('一份');
        return '完成预览';
      },
      ['slide-0'],
    );
    expect(result.proposal?.args.summary).toBe('修改');
  });
});
