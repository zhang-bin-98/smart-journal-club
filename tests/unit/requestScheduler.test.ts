import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestScheduler, TemporaryRateLimit } from '../../src/infrastructure/llm/requestScheduler';

describe('共享请求调度', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const limits = { concurrency: 1, queue: 10 };
  const options = () => ({
    signal: new AbortController().signal,
    priority: 'background' as const,
    stage: 'test',
  });
  it('默认允许五个在途请求，释放后立即派发且没有本地分钟窗口', async () => {
    const scheduler = new RequestScheduler();
    const releases: (() => void)[] = [];
    let started = 0;
    const jobs = Array.from({ length: 36 }, () =>
      scheduler.run({
        ...options(),
        execute: () => {
          started++;
          return new Promise<void>((resolve) => releases.push(resolve));
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBe(5);
    while (started < 36) {
      for (const release of releases.splice(0)) release();
      await vi.advanceTimersByTimeAsync(0);
    }
    for (const release of releases) release();
    await Promise.all(jobs);
    expect(scheduler.snapshot()).toMatchObject({ running: 0, queued: 0 });
  });
  it('队列满时等待空间，排队和等待入队均可取消且不会迟到发送', async () => {
    const scheduler = new RequestScheduler({ concurrency: 1, queue: 1 });
    let release!: () => void;
    const first = scheduler.run({
      ...options(),
      execute: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const execute = vi.fn(async () => 1);
    const controllers = [new AbortController(), new AbortController()];
    const canceled = controllers.map((controller) =>
      scheduler.run({ ...options(), signal: controller.signal, execute }).catch((cause) => cause),
    );
    const last = scheduler.run({ ...options(), execute });
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.snapshot()).toMatchObject({ running: 1, queued: 3 });
    for (const controller of controllers) controller.abort();
    for (const result of canceled) expect(await result).toMatchObject({ name: 'AbortError' });
    release();
    await first;
    expect(await last).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
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
    await vi.advanceTimersByTimeAsync(0);
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
  it('遵循超过两分钟的 Retry-After，仍最多重试两次', async () => {
    const scheduler = new RequestScheduler(limits);
    const execute = vi.fn().mockRejectedValueOnce(new TemporaryRateLimit('test', 180000)).mockResolvedValue('done');
    const pending = scheduler.run({ ...options(), execute });
    await vi.advanceTimersByTimeAsync(179999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('done');
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
