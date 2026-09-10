import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestScheduler, TemporaryRateLimit } from '../../src/infrastructure/llm/requestScheduler';

describe('共享请求调度', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const limits = { concurrency: 1, requests: 10, tokens: 100, windowMs: 1000, queue: 10 };
  const options = () => ({
    signal: new AbortController().signal,
    tokens: 10,
    priority: 'background' as const,
    stage: 'test',
  });
  it('在途预算共用且交互连续两次后让分析前进', async () => {
    const scheduler = new RequestScheduler(limits);
    let release!: () => void;
    const order: string[] = [];
    const first = scheduler.run({
      ...options(),
      execute: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    await Promise.resolve();
    const jobs = ['background', 'interactive', 'interactive', 'interactive'].map((priority) =>
      scheduler.run({
        ...options(),
        priority: priority as 'background' | 'interactive',
        execute: async () => {
          order.push(priority);
        },
      }),
    );
    expect(scheduler.snapshot()).toMatchObject({ running: 1, queued: 4 });
    release();
    await Promise.all([first, ...jobs]);
    expect(order).toEqual(['interactive', 'interactive', 'background', 'interactive']);
  });
  it.each([
    { requests: 1, tokens: 100 },
    { requests: 10, tokens: 10 },
  ])('请求和 Token 窗口各自生效 %j，排队可立即取消', async (budget) => {
    const scheduler = new RequestScheduler({ ...limits, ...budget });
    const execute = vi.fn(async () => 'done');
    await scheduler.run({ ...options(), execute });
    const controller = new AbortController();
    const canceled = scheduler.run({ ...options(), signal: controller.signal, execute }).catch((cause) => cause);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await canceled).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(1);
    await scheduler.run({ ...options(), execute });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('临时限流最多重试两次且整个桶退避，取消不会迟到发送', async () => {
    const scheduler = new RequestScheduler(limits);
    const execute = vi.fn(async () => {
      throw new TemporaryRateLimit('test', 100);
    });
    const result = scheduler.run({ ...options(), execute }).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toMatchObject({ code: 'rate-limit' });
    expect(execute).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    const next = scheduler.run({ ...options(), signal: controller.signal, execute }).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await next).toMatchObject({ name: 'AbortError' });
    const count = execute.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(execute).toHaveBeenCalledTimes(count);
  });
  it('不可分类错误不重试；可读的服务额度只收紧发送时间', async () => {
    const scheduler = new RequestScheduler(limits);
    const execute = vi.fn(async () => {
      throw new Error('not transient');
    });
    await expect(scheduler.run({ ...options(), execute })).rejects.toThrow('not transient');
    expect(execute).toHaveBeenCalledTimes(1);
    scheduler.observe(new Headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2s' }));
    const success = vi.fn(async () => 1);
    const pending = scheduler.run({ ...options(), execute: success });
    await vi.advanceTimersByTimeAsync(1999);
    expect(success).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(1);
  });
});
