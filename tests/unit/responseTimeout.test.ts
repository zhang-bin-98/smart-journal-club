import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { responseTimeout } from '../../src/infrastructure/llm/responseTimeout';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('首响应与停滞使用各自配置；原始 SSE 心跳也刷新停滞计时', async () => {
  const timeout = responseTimeout({ ...DEFAULT_SETTINGS, firstResponseTimeoutSeconds: 2, idleTimeoutSeconds: 3 });
  await vi.advanceTimersByTimeAsync(1999);
  expect(timeout.signal.aborted).toBe(false);
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const watched = timeout.watch(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          input = controller;
        },
      }),
    ),
  );
  const reader = watched.body!.getReader();
  for (let index = 0; index < 3; index++) {
    await vi.advanceTimersByTimeAsync(2500);
    input.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
    await reader.read();
    expect(timeout.signal.aborted).toBe(false);
  }
  await vi.advanceTimersByTimeAsync(3000);
  expect(timeout.signal.aborted).toBe(true);
  await reader.cancel();
  timeout.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('配置总时长后持续响应也会按时退出，默认不限；完成后不再启动计时', async () => {
  const timeout = responseTimeout({
    ...DEFAULT_SETTINGS,
    firstResponseTimeoutSeconds: 2,
    idleTimeoutSeconds: 2,
    totalTimeoutSeconds: 5,
  });
  for (let index = 0; index < 4; index++) {
    await vi.advanceTimersByTimeAsync(1000);
    timeout.activity();
    expect(timeout.signal.aborted).toBe(false);
  }
  await vi.advanceTimersByTimeAsync(1000);
  expect(timeout.signal.aborted).toBe(true);
  timeout.dispose();
  timeout.activity();
  expect(vi.getTimerCount()).toBe(0);
});
