import type { PdfTextItem, PdfTextResult } from './textBlocks';

export interface TextWorker {
  onmessage: ((event: MessageEvent<{ id: number; result?: PdfTextResult; error?: string }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: { id: number; items: PdfTextItem[] }): void;
  terminate(): void;
}

type Job = {
  id: number;
  items: PdfTextItem[];
  signal: AbortSignal;
  resolve: (value: PdfTextResult) => void;
  reject: (reason: unknown) => void;
  cancel: () => void;
};
type Slot = { worker: TextWorker; job?: Job; timer?: ReturnType<typeof setTimeout> };

export function pdfError(code: string, message: string) {
  return Object.assign(new Error(message), { stage: 'paper-parse', code, recovery: '重试此页，或重新打开项目' });
}

/** A small text-only pool. Cancellation terminates synchronous work before reusing its slot. */
export class PdfTextWorkerPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private disposed = false;

  constructor(
    private readonly createWorker: () => TextWorker = () =>
      new Worker(new URL('./textBlocks.worker.ts', import.meta.url), { type: 'module' }),
    private readonly concurrency = 2,
    private readonly timeoutMs = 30_000,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2)
      throw new Error('PDF Worker 数量须为 1–2');
  }

  reconstruct(items: PdfTextItem[], signal: AbortSignal): Promise<PdfTextResult> {
    signal.throwIfAborted();
    if (this.disposed) return Promise.reject(pdfError('resource-closed', '项目已关闭'));
    if (this.queue.length >= 16) return Promise.reject(pdfError('local-queue-full', '本地解析队列已满，请稍后重试'));
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        items,
        signal,
        resolve,
        reject,
        cancel: () => {
          const slot = this.slots.find((item) => item.job === job);
          if (slot) this.finish(slot, undefined, signal.reason, true);
          else {
            this.queue = this.queue.filter((item) => item !== job);
            signal.removeEventListener('abort', job.cancel);
            reject(signal.reason);
          }
        },
      };
      signal.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private finish(slot: Slot, result?: PdfTextResult, error?: unknown, destroy = false) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(slot.timer);
    slot.job = undefined;
    job.signal.removeEventListener('abort', job.cancel);
    if (destroy) {
      slot.worker.terminate();
      this.slots = this.slots.filter((item) => item !== slot);
    }
    if (result) job.resolve(result);
    else job.reject(error ?? pdfError('worker-failed', 'PDF 文本 Worker 未返回完整结果'));
    this.pump();
  }

  private pump() {
    if (this.disposed) return;
    while (this.queue.length) {
      let slot = this.slots.find((item) => !item.job);
      if (!slot && this.slots.length < this.concurrency) {
        try {
          slot = { worker: this.createWorker() };
          const ownedSlot = slot;
          slot.worker.onmessage = ({ data }) => {
            if (data.id !== ownedSlot.job?.id) return;
            this.finish(
              ownedSlot,
              data.result,
              data.error ? pdfError('text-reconstruction-failed', data.error) : undefined,
            );
          };
          slot.worker.onerror = () =>
            this.finish(ownedSlot, undefined, pdfError('worker-crashed', 'PDF 文本 Worker 已中断，请重试此页'), true);
          this.slots.push(slot);
        } catch {
          const job = this.queue.shift()!;
          job.signal.removeEventListener('abort', job.cancel);
          job.reject(pdfError('worker-unavailable', '无法启动 PDF 文本 Worker'));
          continue;
        }
      }
      if (!slot) break;
      const job = this.queue.shift()!;
      slot.job = job;
      const ownedSlot = slot;
      slot.timer = setTimeout(
        () => this.finish(ownedSlot, undefined, pdfError('worker-timeout', 'PDF 文本重建超时'), true),
        this.timeoutMs,
      );
      try {
        slot.worker.postMessage({ id: job.id, items: job.items });
      } catch {
        this.finish(slot, undefined, pdfError('worker-crashed', 'PDF 文本 Worker 已中断'), true);
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const job of this.queue.splice(0)) {
      job.signal.removeEventListener('abort', job.cancel);
      job.reject(pdfError('resource-closed', '项目已关闭'));
    }
    for (const slot of [...this.slots]) {
      if (slot.job) this.finish(slot, undefined, pdfError('resource-closed', '项目已关闭'), true);
      else slot.worker.terminate();
    }
    this.slots = [];
  }
}
