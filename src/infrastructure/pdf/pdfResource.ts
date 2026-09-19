import {
  GlobalWorkerOptions,
  getDocument,
  OPS,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { BBoxSchema, type BBox } from '../../shared/schema';
import { PdfTextWorkerPool, pdfError } from './localCompute';
import { abortable, boundedDestroy, PdfResourceQueue } from './resourceQueue';
import type { PdfTextBlock } from './textBlocks';

GlobalWorkerOptions.workerSrc = workerUrl;
export const PDF_PREVIEW_EDGE = 1400;
export const PDF_EXPORT_EDGE = 2800;
const IMAGE_CACHE_SIZE = 24;
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const imageQueue = new PdfResourceQueue();

export async function checkPdfFile(file: File) {
  if (!/\.pdf$/i.test(file.name) || !file.size) throw new Error('请选择一份有效 PDF');
  const header = new TextDecoder('ascii').decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes('%PDF-')) throw new Error('文件不是有效 PDF，请重新选择');
}
export type PdfPageText = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  blocks: PdfTextBlock[];
};
export class PdfResource {
  private loading?: PDFDocumentLoadingTask;
  private document?: Promise<PDFDocumentProxy>;
  private loaded?: PDFDocumentProxy;
  private generation = 0;
  private disposed = false;
  private images = new Map<string, { value: string; bytes: number }>();
  private pendingImages = new Map<string, Promise<string>>();
  private renders = new Set<RenderTask>();
  private lifetime = new AbortController();
  private textWorkers = new PdfTextWorkerPool();
  constructor(private readonly blob: Blob) {}

  async getDocument() {
    if (this.disposed) throw pdfError('resource-closed', '项目已关闭');
    if (!this.document) {
      const generation = ++this.generation;
      this.document = (async () => {
        const data = await this.blob.arrayBuffer();
        this.lifetime.signal.throwIfAborted();
        const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
        const loading = getDocument({
          data,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
        });
        this.loading = loading;
        try {
          const pdf = await loading.promise;
          this.lifetime.signal.throwIfAborted();
          this.loaded = pdf;
          return pdf;
        } catch (error) {
          if (error instanceof Error && error.name === 'PasswordException')
            throw pdfError('pdf-encrypted', '加密 PDF 暂不支持，请更换可解析版本');
          throw error;
        }
      })().catch(async (error) => {
        if (generation !== this.generation) throw error;
        const loading = this.loading;
        this.document = undefined;
        this.loading = undefined;
        await boundedDestroy(loading?.destroy());
        throw error;
      });
    }
    return this.document;
  }

  async pageTexts(signal: AbortSignal): Promise<PdfPageText[]> {
    const pages: PdfPageText[] = [];
    for await (const page of this.iteratePageTexts(signal)) pages.push(page);
    return pages;
  }
  async *iteratePageTexts(signal: AbortSignal): AsyncGenerator<PdfPageText> {
    const pdf = await abortable(this.getDocument(), AbortSignal.any([signal, this.lifetime.signal]));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) yield await this.pageText(pageNumber, signal);
  }
  /** Extract one full page; callers attach document identity and persist a complete unit. */
  async pageText(pageNumber: number, inputSignal: AbortSignal): Promise<PdfPageText> {
    const signal = AbortSignal.any([inputSignal, this.lifetime.signal]);
    const pdf = await abortable(this.getDocument(), signal);
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
    try {
      page = await abortable(pdf.getPage(pageNumber), signal);
      const viewport = page.getViewport({ scale: 1 });
      const content = await abortable(page.getTextContent(), signal);
      const items = content.items.flatMap((item) =>
        'str' in item
          ? [
              {
                str: item.str,
                hasEOL: item.hasEOL,
                x: item.transform[4],
                y: item.transform[5],
                height: item.height,
              },
            ]
          : [],
      );
      const result = await this.textWorkers.reconstruct(items, signal);
      signal.throwIfAborted();
      return { pageNumber, width: viewport.width, height: viewport.height, ...result };
    } catch (error) {
      if (!signal.aborted) this.invalidateDocument(pdf);
      throw error;
    } finally {
      page?.cleanup();
    }
  }
  private invalidateDocument(expected: PDFDocumentProxy) {
    if (this.loaded !== expected) return;
    this.generation++;
    this.loaded = undefined;
    const loading = this.loading;
    this.document = undefined;
    this.loading = undefined;
    void boundedDestroy(loading?.destroy());
  }
  async documentTitle() {
    const pdf = await this.getDocument();
    const metadata = await abortable(pdf.getMetadata(), this.lifetime.signal);
    const title = (metadata.info as { Title?: unknown }).Title;
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  }
  async render(pageNumber: number, canvas: HTMLCanvasElement, edge: number, signal: AbortSignal) {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    return imageQueue.run(combined, () => this.renderPage(pageNumber, canvas, edge, combined));
  }
  /** 直接从 PDF 渲染选区；画布仅分配局部尺寸，不先生成巨幅整页位图。 */
  async renderRegion(pageNumber: number, canvas: HTMLCanvasElement, bbox: BBox, edge: number, signal: AbortSignal) {
    BBoxSchema.parse(bbox);
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    return imageQueue.run(combined, () => this.renderPage(pageNumber, canvas, edge, combined, bbox));
  }
  private async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    edge: number,
    signal: AbortSignal,
    bbox: BBox = { x: 0, y: 0, width: 1, height: 1 },
  ) {
    signal.throwIfAborted();
    if (!Number.isFinite(edge) || edge <= 0 || edge > PDF_EXPORT_EDGE)
      throw pdfError('invalid-render-size', 'PDF 渲染尺寸无效');
    const pdf = await abortable(this.getDocument(), signal);
    const page = await abortable(pdf.getPage(pageNumber), signal);
    signal.throwIfAborted();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: edge / Math.max(base.width * bbox.width, base.height * bbox.height) });
    canvas.width = Math.ceil(viewport.width * bbox.width);
    canvas.height = Math.ceil(viewport.height * bbox.height);
    const task = page.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -bbox.x * viewport.width, -bbox.y * viewport.height],
    });
    const cancel = () => task.cancel();
    this.renders.add(task);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await abortable(task.promise, signal);
      signal.throwIfAborted();
    } catch (error) {
      if (!signal.aborted) this.invalidateDocument(pdf);
      throw error;
    } finally {
      this.renders.delete(task);
      signal.removeEventListener('abort', cancel);
      page.cleanup();
    }
  }
  async imageRegions(pageNumber: number, inputSignal = this.lifetime.signal): Promise<BBox[]> {
    const signal = AbortSignal.any([inputSignal, this.lifetime.signal]);
    const pdf = await abortable(this.getDocument(), signal);
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
    try {
      page = await abortable(pdf.getPage(pageNumber), signal);
      const viewport = page.getViewport({ scale: 1 });
      const operators = await abortable(page.getOperatorList(), signal);
      const stack: number[][] = [];
      let matrix = [1, 0, 0, 1, 0, 0];
      const regions: BBox[] = [];
      const multiply = (left: number[], right: number[]) => [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
      ];
      const point = (transform: number[], x: number, y: number) => [
        transform[0] * x + transform[2] * y + transform[4],
        transform[1] * x + transform[3] * y + transform[5],
      ];
      for (let index = 0; index < operators.fnArray.length; index++) {
        signal.throwIfAborted();
        const fn = operators.fnArray[index];
        const args = operators.argsArray[index] as unknown[] | null;
        if (fn === OPS.save) stack.push([...matrix]);
        else if (fn === OPS.restore) matrix = stack.pop() ?? matrix;
        else if (fn === OPS.transform && args?.length === 6) matrix = multiply(matrix, args as number[]);
        else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && args && args.length >= 3) {
          const width = Number(args[1]);
          const height = Number(args[2]);
          if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
          // PDF.js applies the current transform to the image unit square; args[1/2] are source pixels.
          const points = [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ].map(([x, y]) => {
            const [pointX, pointY] = point(matrix, x, y);
            return viewport.convertToViewportPoint(pointX, pointY);
          });
          const x = Math.max(0, Math.min(...points.map((item) => item[0])) / viewport.width);
          const y = Math.max(0, Math.min(...points.map((item) => item[1])) / viewport.height);
          const right = Math.min(1, Math.max(...points.map((item) => item[0])) / viewport.width);
          const bottom = Math.min(1, Math.max(...points.map((item) => item[1])) / viewport.height);
          if (right - x > 0.03 && bottom - y > 0.03)
            regions.push(BBoxSchema.parse({ x, y, width: right - x, height: bottom - y }));
        }
      }
      return regions;
    } catch (error) {
      if (!signal.aborted) this.invalidateDocument(pdf);
      throw error;
    } finally {
      page?.cleanup();
    }
  }
  async image(source: { id: string; pageNumber: number }, box: BBox, edge = PDF_PREVIEW_EDGE) {
    this.lifetime.signal.throwIfAborted();
    const key = JSON.stringify([source.id, source.pageNumber, box, edge]);
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return cached.value;
    }
    let result = this.pendingImages.get(key);
    if (!result) {
      result = imageQueue.run(this.lifetime.signal, async () => {
        const canvas = document.createElement('canvas');
        try {
          await this.renderPage(source.pageNumber, canvas, edge, this.lifetime.signal);
          const value = cropCanvas(canvas, box);
          const bytes = value.length * 2 + canvas.width * canvas.height * 4;
          if (bytes <= IMAGE_CACHE_BYTES) {
            this.images.set(key, { value, bytes });
            while (
              this.images.size > IMAGE_CACHE_SIZE ||
              [...this.images.values()].reduce((sum, image) => sum + image.bytes, 0) > IMAGE_CACHE_BYTES
            )
              this.images.delete(this.images.keys().next().value!);
          }
          return value;
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      });
      this.pendingImages.set(key, result);
      const clear = () => {
        if (this.pendingImages.get(key) === result) this.pendingImages.delete(key);
      };
      void result.then(clear, clear);
    }
    return result;
  }
  clearImages() {
    this.images.clear();
  }
  async dispose() {
    this.disposed = true;
    this.generation++;
    this.loaded = undefined;
    this.lifetime.abort(pdfError('resource-closed', '项目已关闭'));
    this.textWorkers.dispose();
    this.images.clear();
    this.pendingImages.clear();
    this.renders.forEach((task) => {
      task.cancel();
    });
    await boundedDestroy(this.loading?.destroy());
    this.loading = undefined;
    this.document = undefined;
  }
}
export function cropCanvas(source: HTMLCanvasElement, input: BBox) {
  const box = BBoxSchema.parse(input);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * box.width));
  out.height = Math.max(1, Math.round(source.height * box.height));
  try {
    out
      .getContext('2d')!
      .drawImage(
        source,
        source.width * box.x,
        source.height * box.y,
        source.width * box.width,
        source.height * box.height,
        0,
        0,
        out.width,
        out.height,
      );
    return out.toDataURL('image/png');
  } finally {
    out.width = 0;
    out.height = 0;
  }
}
