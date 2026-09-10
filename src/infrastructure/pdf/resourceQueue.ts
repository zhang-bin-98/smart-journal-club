import { pdfError } from './localCompute';

/** Bound active canvases and queued requests independently of the model scheduler. */
export class PdfResourceQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(
    private readonly concurrency = 2,
    private readonly maxQueued = 32,
  ) {}
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueued) throw pdfError('render-queue-full', '图像准备队列已满，请稍后重试');
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', cancel);
          this.active++;
          resolve();
        };
        const cancel = () => {
          this.waiting = this.waiting.filter((item) => item !== start);
          reject(signal.reason);
        };
        signal.addEventListener('abort', cancel, { once: true });
        this.waiting.push(start);
      });
    } else this.active++;
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** A cancelled consumer stops waiting without destroying a shared PDF document. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export async function boundedDestroy(destroy: Promise<unknown> | undefined) {
  if (!destroy) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      destroy.catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
