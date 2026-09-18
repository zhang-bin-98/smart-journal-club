import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slidesFixture } from '../speech-fixture';
import { createFigureResources } from '../../src/infrastructure/pdf/figureResource';

const renders = vi.hoisted(() => [] as { signal: AbortSignal; finish: () => void }[]);
vi.mock('../../src/infrastructure/pdf/pdfResource', () => ({
  PdfResource: class {
    render(_page: number, canvas: HTMLCanvasElement, _edge: number, signal: AbortSignal) {
      canvas.width = 2200;
      canvas.height = 1600;
      // 故意忽略取消的渲染替身，验证适配器也拒绝迟到结果。
      return new Promise<void>((finish) => renders.push({ signal, finish }));
    }
    async dispose() {}
  },
}));
const canvases: HTMLCanvasElement[] = [];
beforeEach(() => {
  renders.length = 0;
  canvases.length = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
      canvases.push(canvas);
      return canvas;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const { state } = slidesFixture();
  const documentId = state.paper.documents[0].id;
  const resources = createFigureResources({
    ...state,
    assets: { [documentId]: { blob: new Blob(), name: 'fixed.pdf' } },
  });
  return { documentId, resources };
}
describe('图源预览消费者与有界缓存', () => {
  it('全部消费者取消后中止渲染并释放迟到的十张画布', async () => {
    const { documentId, resources } = fixture();
    const work = Array.from({ length: 10 }, (_, i) => {
      const cancel = new AbortController();
      const request = resources.acquire(documentId, i + 1, cancel.signal);
      cancel.abort();
      return request;
    });
    expect((await Promise.allSettled(work)).every((item) => item.status === 'rejected')).toBe(true);
    expect(renders.every((render) => render.signal.aborted)).toBe(true);
    for (const render of renders) render.finish();
    await vi.waitFor(() => expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true));
    resources.dispose();
  });
  it('共享同页请求只渲染一次，一个消费者取消不影响另一个', async () => {
    const { documentId, resources } = fixture();
    const cancel = new AbortController();
    const first = resources.acquire(documentId, 1, cancel.signal);
    const second = resources.acquire(documentId, 1, new AbortController().signal);
    cancel.abort();
    await expect(first).rejects.toThrow();
    expect(renders).toHaveLength(1);
    expect(renders[0].signal.aborted).toBe(false);
    renders[0].finish();
    const bitmap = await second;
    expect(bitmap.canvas.width).toBe(2200);
    bitmap.release();
    bitmap.release();
    const cached = await resources.acquire(documentId, 1, new AbortController().signal);
    expect(renders).toHaveLength(1);
    cached.release();
    resources.dispose();
    expect(bitmap.canvas.width).toBe(0);
  });
  it('重新请求不复用已取消任务；释放引用后缓存保持预算，关闭拒绝迟到结果', async () => {
    const { documentId, resources } = fixture();
    const cancel = new AbortController();
    const first = resources.acquire(documentId, 1, cancel.signal);
    cancel.abort();
    await expect(first).rejects.toThrow();
    const retry = resources.acquire(documentId, 1, new AbortController().signal);
    expect(renders).toHaveLength(2);
    renders[0].finish();
    renders[1].finish();
    (await retry).release();
    for (let page = 2; page <= 10; page++) {
      const request = resources.acquire(documentId, page, new AbortController().signal);
      renders.at(-1)!.finish();
      (await request).release();
    }
    expect(canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0)).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(canvases.filter((c) => c.width).length).toBeLessThanOrEqual(6);
    const late = resources.acquire(documentId, 11, new AbortController().signal);
    resources.dispose();
    await expect(late).rejects.toThrow();
    renders.at(-1)!.finish();
    await vi.waitFor(() => expect(canvases.every((c) => c.width === 0)).toBe(true));
  });
});
