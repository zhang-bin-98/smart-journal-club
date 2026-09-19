import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { stream } from '@earendil-works/pi-ai/api/openai-responses';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_SETTINGS, normalizeSettings } from '../../src/app/settings/modelSettings';
import { createResponsesAdapter } from '../../src/infrastructure/llm/responses';
import { RequestScheduler } from '../../src/infrastructure/llm/requestScheduler';
let scheduler: RequestScheduler;
const requestModel: ReturnType<typeof createResponsesAdapter>['request'] = (input) =>
  createResponsesAdapter(scheduler, normalizeSettings, DEFAULT_CONTEXT_WINDOW).request(input);

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

async function start(onText?: (delta: string) => void, maxTokens = 16384) {
  const controller = new AbortController();
  const events = new AssistantMessageEventStream();
  vi.mocked(stream).mockReturnValue(events);
  const result = requestModel({
    settings: {
      ...DEFAULT_SETTINGS,
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-flash',
      apiKey: 'fixed-test-key',
      contextWindow: 1048576,
      maxOutputTokens: maxTokens,
    },
    context: { messages: [] },
    signal: controller.signal,
    stage: 'figures',
    json: false,
    maxTokens,
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
  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new RequestScheduler();
    vi.mocked(stream).mockReset();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('流没有产生任何事件时，3 分钟预算到期也必须结束等待', async () => {
    const { result } = await start();
    await vi.advanceTimersByTimeAsync(180000);
    expect(await settled(result)).toMatchObject({ stage: 'figures', code: 'timeout' });
    expect(vi.mocked(stream).mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  it('流已结束但结果 promise 没有完成时仍必须超时', async () => {
    const { events, result } = await start();
    events.end();
    await vi.advanceTimersByTimeAsync(180000);
    expect(await settled(result)).toMatchObject({ code: 'timeout' });
  });

  it('用户取消立即结束等待，迟到内容不再进入 UI', async () => {
    const onText = vi.fn();
    const { controller, events, result } = await start(onText);
    controller.abort();
    expect(await settled(result)).toMatchObject({ name: 'AbortError' });
    events.push({ type: 'text_delta', contentIndex: 0, delta: 'late', partial: message });
    events.push({ type: 'done', reason: 'stop', message });
    await vi.advanceTimersByTimeAsync(0);
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
    expect(vi.getTimerCount()).toBe(0);
  });
  it('持续收到响应不受输出大小或三十分钟总时长限制，仍可取消', async () => {
    const { controller, events, result } = await start(undefined, 384000);
    let finished = false;
    void result.then(() => {
      finished = true;
    });
    for (let index = 0; index < 20; index++) {
      await vi.advanceTimersByTimeAsync(120000);
      events.push({ type: 'text_delta', contentIndex: 0, delta: '.', partial: message });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(finished).toBe(false);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('排队超过三分钟不会耗尽发送后的响应时间', async () => {
    scheduler.observe(new Headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '4m' }));
    const events = new AssistantMessageEventStream();
    vi.mocked(stream).mockReturnValue(events);
    const result = requestModel({
      settings: { ...DEFAULT_SETTINGS, baseUrl: 'https://models.example', modelId: 'fixture', apiKey: 'fixed' },
      context: { messages: [] },
      signal: new AbortController().signal,
      stage: 'figures',
    }).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(239999);
    expect(stream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stream).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(stream).mock.calls[0][2]!.signal!;
    await vi.advanceTimersByTimeAsync(179999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ code: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
