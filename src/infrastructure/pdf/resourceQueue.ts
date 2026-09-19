import { QueueCapacity } from '../../shared/queueCapacity';

/** Bound active canvases and queued requests independently of the model scheduler. */
export class PdfResourceQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  private capacity = new QueueCapacity();
  constructor(
    private readonly concurrency = 2,
    private readonly maxQueued = 32,
  ) {}
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    while (this.active >= this.concurrency && this.waiting.length >= this.maxQueued)
      await this.capacity.wait(signal, () => this.active >= this.concurrency && this.waiting.length >= this.maxQueued);
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', cancel);
          this.active++;
          resolve();
        };
        const cancel = () => {
          this.waiting = this.waiting.filter((item) => item !== start);
          this.capacity.notify();
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
      this.capacity.notify();
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
