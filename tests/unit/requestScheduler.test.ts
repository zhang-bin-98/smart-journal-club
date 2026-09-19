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
  it('超过速率桶的大请求等空窗口独占执行，跨窗口仍不与其他请求并行', async () => {
    const scheduler = new RequestScheduler({ ...limits, concurrency: 2 });
    await scheduler.run({ ...options(), execute: async () => 1 });
    let release!: () => void;
    const large = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(150);
        }),
    );
    const pending = scheduler.run({ ...options(), tokens: 150, execute: large, actualTokens: (value) => value });
    await vi.advanceTimersByTimeAsync(999);
    expect(large).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(large).toHaveBeenCalledTimes(1);
    const small = vi.fn(async () => 2);
    const next = scheduler.run({ ...options(), execute: small });
    await vi.advanceTimersByTimeAsync(1000);
    expect(small).not.toHaveBeenCalled();
    release();
    expect(await pending).toBe(150);
    expect(await next).toBe(2);
  });
  it('大请求等待在途请求完成，取消后不迟到派发', async () => {
    const scheduler = new RequestScheduler({ ...limits, concurrency: 2 });
    let release!: () => void;
    const running = scheduler.run({
      ...options(),
      execute: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const controller = new AbortController();
    const execute = vi.fn(async () => 1);
    const pending = scheduler
      .run({ ...options(), tokens: 150, signal: controller.signal, execute })
      .catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).not.toHaveBeenCalled();
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    release();
    await running;
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).not.toHaveBeenCalled();
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
