import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { stream } from '@earendil-works/pi-ai/api/openai-responses';
import { DEFAULT_SETTINGS, requestModel } from '../../src/app/model';

vi.mock('@earendil-works/pi-ai/api/openai-responses', () => ({ stream: vi.fn() }));

const message: AssistantMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'fixed' }],
  api: 'openai-responses',
  provider: 'responses',
  model: DEFAULT_SETTINGS.modelId,
  stopReason: 'stop',
  timestamp: 0,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

async function start(onText?: (delta: string) => void) {
  const controller = new AbortController();
  const events = new AssistantMessageEventStream();
  vi.mocked(stream).mockReturnValue(events);
  const result = requestModel({
    settings: {
      ...DEFAULT_SETTINGS,
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-flash',
      apiKey: 'fixed-test-key',
    },
    context: { messages: [] },
    signal: controller.signal,
    stage: 'figures',
    json: false,
    maxTokens: 16384,
    outputTool: undefined,
    onText: onText,
  }).then(
    (value) => value,
    (error) => error,
  );
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  return { controller, events, result };
}

// SDK 故意不响应取消；应用必须自行退出等待，不能让测试随请求永久挂起。
async function settled(result: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('still-pending'), 50);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('模型请求的独立超时和取消边界', () => {
  let timeout: AbortController;
  beforeEach(() => {
    vi.mocked(stream).mockReset();
    vi.stubGlobal('navigator', { onLine: true });
    timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('流没有产生任何事件时，3 分钟预算到期也必须结束等待', async () => {
    const { result } = await start();
    expect(AbortSignal.timeout).toHaveBeenCalledWith(180000);
    timeout.abort(new DOMException('expired', 'TimeoutError'));
    expect(await settled(result)).toMatchObject({ stage: 'figures', code: 'timeout' });
    expect(vi.mocked(stream).mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  it('流已结束但结果 promise 没有完成时仍必须超时', async () => {
    const { events, result } = await start();
    events.end();
    timeout.abort(new DOMException('expired', 'TimeoutError'));
    expect(await settled(result)).toMatchObject({ code: 'timeout' });
  });

  it('用户取消立即结束等待，迟到内容不再进入 UI', async () => {
    const onText = vi.fn();
    const { controller, events, result } = await start(onText);
    controller.abort();
    expect(await settled(result)).toMatchObject({ name: 'AbortError' });
    events.push({ type: 'text_delta', contentIndex: 0, delta: 'late', partial: message });
    events.push({ type: 'done', reason: 'stop', message });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onText).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('正常流保留增量与最终结果，并移除取消监听', async () => {
    const onText = vi.fn();
    const { events, result } = await start(onText);
    const signal = vi.mocked(stream).mock.calls[0][2]!.signal!;
    const remove = vi.spyOn(signal, 'removeEventListener');
    events.push({ type: 'text_delta', contentIndex: 0, delta: 'fixed', partial: message });
    events.push({ type: 'done', reason: 'stop', message });
    expect(await settled(result)).toEqual(message);
    expect(onText).toHaveBeenCalledExactlyOnceWith('fixed');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
