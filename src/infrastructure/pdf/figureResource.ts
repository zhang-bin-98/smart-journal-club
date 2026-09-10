import type { FigureResources, FigureBitmap } from '../../app/paper/figureResources';
import type { AnalysisProject } from '../../app/paper/ports';
import type { BBox } from '../../shared/schema';
import type { PixelInput, PixelResult } from '../../modules/paper/figurePixels';
import { PdfResource } from './pdfResource';
import { PdfResourceQueue, abortable } from './resourceQueue';
import { pdfError } from './localCompute';

/** One bounded project cache. In-use canvases cannot be evicted; pixel tasks use the existing local queue. */
export function createFigureResources(data: AnalysisProject): FigureResources {
  const resources = new Map<string, PdfResource>();
  const cache = new Map<string, { canvas: HTMLCanvasElement; users: number }>();
  const pending = new Map<string, Promise<{ canvas: HTMLCanvasElement; users: number }>>();
  const lifetime = new AbortController();
  const resource = (documentId: string) => {
    let value = resources.get(documentId);
    if (!value) {
      const asset = data.assets[documentId];
      if (!asset) throw pdfError('missing-pdf', '原文件不存在。');
      value = new PdfResource(asset.blob);
      resources.set(documentId, value);
    }
    return value;
  };
  function evict() {
    let bytes = [...cache.values()].reduce((sum, item) => sum + item.canvas.width * item.canvas.height * 4, 0);
    for (const [key, entry] of cache) {
      if (cache.size <= 6 && bytes <= 48 * 1024 * 1024) break;
      if (entry.users) continue;
      bytes -= entry.canvas.width * entry.canvas.height * 4;
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      cache.delete(key);
    }
  }
  async function acquire(documentId: string, pageNumber: number, signal: AbortSignal): Promise<FigureBitmap> {
    signal.throwIfAborted();
    lifetime.signal.throwIfAborted();
    const doc = data.paper.documents.find((item) => item.id === documentId)!;
    const key = `${documentId}:${doc.pdfAssetId}:${pageNumber}:2200`;
    let entry = cache.get(key);
    if (!entry) {
      let work = pending.get(key);
      if (!work) {
        work = (async () => {
          const canvas = document.createElement('canvas');
          try {
            await resource(documentId).render(pageNumber, canvas, 2200, lifetime.signal);
            const value = { canvas, users: 0 };
            cache.set(key, value);
            return value;
          } catch (cause) {
            canvas.width = 0;
            canvas.height = 0;
            throw cause;
          } finally {
            pending.delete(key);
          }
        })();
        pending.set(key, work);
      }
      entry = await abortable(work, signal);
    }
    signal.throwIfAborted();
    entry.users++;
    cache.delete(key);
    cache.set(key, entry);
    evict();
    let released = false;
    return {
      canvas: entry.canvas,
      release() {
        if (released) return;
        released = true;
        entry!.users--;
        evict();
      },
    };
  }

  return {
    acquire,
    async local(documentId, pageNumber, bbox: BBox, inputSignal) {
      const signal = AbortSignal.any([inputSignal, lifetime.signal]);
      const page = await acquire(documentId, pageNumber, signal);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(page.canvas.width * bbox.width));
      canvas.height = Math.max(1, Math.round(page.canvas.height * bbox.height));
      canvas
        .getContext('2d')!
        .drawImage(
          page.canvas,
          bbox.x * page.canvas.width,
          bbox.y * page.canvas.height,
          bbox.width * page.canvas.width,
          bbox.height * page.canvas.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      page.release();
      return {
        image: canvas.toDataURL('image/png'),
        refine: (boxes) => {
          const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
          return runFigurePixels({ width: canvas.width, height: canvas.height, data: image.data, boxes }, signal);
        },
        release() {
          canvas.width = 0;
          canvas.height = 0;
        },
      };
    },
    dispose() {
      lifetime.abort();
      for (const entry of cache.values()) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      }
      cache.clear();
      for (const pdf of resources.values()) void pdf.dispose();
      resources.clear();
    },
  };
}

const pixelQueue = new PdfResourceQueue(1, 4);
export async function runFigurePixels(input: PixelInput, signal: AbortSignal) {
  return pixelQueue.run(
    signal,
    () =>
      new Promise<PixelResult>((resolve, reject) => {
        const worker = new Worker(new URL('./figurePixels.worker.ts', import.meta.url), { type: 'module' });
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
          worker.terminate();
        };
        const cancel = () => {
          finish();
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          finish();
          reject(pdfError('worker-timeout', '像素分析超时，请重试当前图。'));
        }, 30000);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onmessage = ({ data }) => {
          finish();
          if (data.result) resolve(data.result);
          else reject(pdfError('pixel-failed', '局部像素分析失败，请重试。'));
        };
        worker.onerror = () => {
          finish();
          reject(pdfError('worker-crashed', '像素 Worker 已中断，请重试。'));
        };
        worker.postMessage(input, [input.data.buffer]);
      }),
  );
}

/** Local high-resolution input uses original PDF pixels, never a UI screenshot. */
export async function localFigureInput(resource: PdfResource, pageNumber: number, bbox: BBox, signal: AbortSignal) {
  const page = document.createElement('canvas');
  const local = document.createElement('canvas');
  try {
    await resource.render(pageNumber, page, 2800, signal);
    local.width = Math.max(1, Math.round(page.width * bbox.width));
    local.height = Math.max(1, Math.round(page.height * bbox.height));
    local
      .getContext('2d')!
      .drawImage(
        page,
        bbox.x * page.width,
        bbox.y * page.height,
        bbox.width * page.width,
        bbox.height * page.height,
        0,
        0,
        local.width,
        local.height,
      );
    return {
      image: local.toDataURL('image/png'),
      refine: (boxes: BBox[]) => {
        const image = local.getContext('2d')!.getImageData(0, 0, local.width, local.height);
        return runFigurePixels({ width: local.width, height: local.height, data: image.data, boxes }, signal);
      },
      release() {
        local.width = 0;
        local.height = 0;
      },
    };
  } catch (cause) {
    local.width = 0;
    local.height = 0;
    throw cause;
  } finally {
    page.width = 0;
    page.height = 0;
  }
}
