import { describe, expect, it, vi } from 'vitest';
import { PdfTextWorkerPool, type TextWorker } from '../../src/infrastructure/pdf/localCompute';
import { PdfResourceQueue } from '../../src/infrastructure/pdf/resourceQueue';
import { reconstructTextBlocks, type PdfTextItem } from '../../src/infrastructure/pdf/textBlocks';

const item = (str: string, y = 100): PdfTextItem => ({ str, hasEOL: true, x: 10, y, height: 10 });
class FakeWorker implements TextWorker {
  onmessage: TextWorker['onmessage'] = null;
  onerror: TextWorker['onerror'] = null;
  terminate = vi.fn();
  messages: { id: number; items: PdfTextItem[] }[] = [];
  postMessage(message: { id: number; items: PdfTextItem[] }) {
    this.messages.push(message);
  }
  complete(index = this.messages.length - 1) {
    const message = this.messages[index];
    this.onmessage?.({ data: { id: message.id, result: reconstructTextBlocks(message.items) } } as MessageEvent);
  }
}
const signal = () => new AbortController().signal;

describe('PDF local computation', () => {
  it('keeps all extracted text and separates paragraphs without shortening methods or captions', () => {
    const long = '方法与发现'.repeat(5000);
    const result = reconstructTextBlocks([item('Figure 1 完整图注'), item(long, 50)]);
    expect(result.blocks).toEqual([{ text: 'Figure 1 完整图注' }, { text: long }]);
    expect(result.text).toBe(`Figure 1 完整图注\n\n${long}`);
  });
  it('bounds active workers, routes out-of-order results, and ignores stale messages', async () => {
    const workers: FakeWorker[] = [];
    const pool = new PdfTextWorkerPool(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = pool.reconstruct([item('main p1')], signal());
    const second = pool.reconstruct([item('supplement p1')], signal());
    const third = pool.reconstruct([item('main p2')], signal());
    expect(workers).toHaveLength(2);
    workers[1].complete();
    expect((await second).text).toBe('supplement p1');
    workers[1].complete(0);
    workers[0].complete();
    workers[1].complete();
    expect((await first).text).toBe('main p1');
    expect((await third).text).toBe('main p2');
    pool.dispose();
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
  it('removes cancelled queued work and terminates active computation before restarting', async () => {
    const workers: FakeWorker[] = [];
    const pool = new PdfTextWorkerPool(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 1);
    const active = new AbortController();
    const queued = new AbortController();
    const first = pool.reconstruct([item('active')], active.signal).catch((error) => error);
    const second = pool.reconstruct([item('queued')], queued.signal).catch((error) => error);
    queued.abort('queued cancelled');
    active.abort('active cancelled');
    expect(await first).toBe('active cancelled');
    expect(await second).toBe('queued cancelled');
    expect(workers[0].messages).toHaveLength(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const next = pool.reconstruct([item('fresh')], signal());
    workers[1].complete();
    expect((await next).text).toBe('fresh');
    pool.dispose();
  });
  it('fails a crashed unit and reconstructs a worker only for the next valid request', async () => {
    const workers: FakeWorker[] = [];
    const pool = new PdfTextWorkerPool(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, 1);
    const failed = pool.reconstruct([item('broken')], signal()).catch((error) => error);
    workers[0].onerror?.({} as ErrorEvent);
    expect((await failed).code).toBe('worker-crashed');
    const retry = pool.reconstruct([item('retry')], signal());
    workers[1].complete();
    expect((await retry).text).toBe('retry');
    pool.dispose();
  });
  it('terminates a stalled worker at the deadline and rejects disposal without late work', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const pool = new PdfTextWorkerPool(() => worker, 1, 20);
    const failed = pool.reconstruct([item('stalled')], signal()).catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect((await failed).code).toBe('worker-timeout');
    expect(worker.terminate).toHaveBeenCalledOnce();
    pool.dispose();
    await expect(pool.reconstruct([], signal())).rejects.toMatchObject({ code: 'resource-closed' });
    vi.useRealTimers();
  });
});

describe('bounded PDF resource queue', () => {
  it('holds active resources to the configured bound and never dispatches a cancelled waiter', async () => {
    const queue = new PdfResourceQueue(1, 2);
    let release!: () => void;
    const first = queue.run(
      signal(),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const cancel = new AbortController();
    const work = vi.fn(async () => 2);
    const aborted = queue.run(cancel.signal, work).catch((error) => error);
    const third = queue.run(signal(), async () => 3);
    cancel.abort('no consumer');
    release();
    await first;
    expect(await aborted).toBe('no consumer');
    expect(await third).toBe(3);
    expect(work).not.toHaveBeenCalled();
  });
});
