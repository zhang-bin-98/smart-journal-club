import { GlobalWorkerOptions, getDocument, OPS, type PDFDocumentProxy, type PDFDocumentLoadingTask, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { BBoxSchema, type BBox } from './shared/schema';
import type { Element } from './modules/deck/deck.schema';
import type { Paper } from './modules/paper/paper.schema';
import { figureSource } from './sources';
GlobalWorkerOptions.workerSrc = workerUrl;

export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_PAGES = 80;
export const PDF_PREVIEW_EDGE = 1400;
export const PDF_EXPORT_EDGE = 2800;
const IMAGE_CACHE_SIZE = 24;

export async function checkPdfFile(file: File) {
  if (!/\.pdf$/i.test(file.name) || !file.size) throw new Error('请选择一份有效 PDF');
  if (file.size > PDF_MAX_BYTES) throw new Error('PDF 超过 25 MB，请选择较小的可解析版本');
  const header = new TextDecoder('ascii').decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes('%PDF-')) throw new Error('文件不是有效 PDF，请重新选择');
}
export class PdfResource {
  private loading?: PDFDocumentLoadingTask;
  private document?: Promise<PDFDocumentProxy>;
  private disposed = false;
  private images = new Map<string, Promise<string>>();
  private renders = new Set<RenderTask>();
  constructor(private readonly blob: Blob) {}
  async getDocument() {
    if (this.disposed) throw new Error('项目已关闭');
    if (!this.document) this.document = (async () => {
      const data = await this.blob.arrayBuffer();
      if (this.disposed) throw new Error('项目已关闭');
      const assets = new URL(import.meta.env.BASE_URL + 'pdfjs/', document.baseURI).href;
      this.loading = getDocument({ data, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/' });
      try {
        const pdf = await this.loading.promise;
        if (pdf.numPages > PDF_MAX_PAGES) throw new Error('PDF 超过 80 页，请选择正文版本');
        return pdf;
      } catch (error) {
        if (error instanceof Error && error.name === 'PasswordException') throw new Error('加密 PDF 暂不支持，请更换可解析版本');
        throw error;
      }
    })();
    return this.document;
  }
  async parse(paper: Paper, signal: AbortSignal): Promise<Paper> {
    const pdf = await this.getDocument();
    const pages: Paper['pages'] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ pageNumber, width: viewport.width, height: viewport.height, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim() });
      page.cleanup();
    }
    signal.throwIfAborted();
    if (pages.reduce((total, page) => total + page.text.length, 0) < 100) throw new Error('未提取到足够文字，扫描件暂不支持，请更换可解析版本');
    const metadata = await pdf.getMetadata();
    const title = (metadata.info as { Title?: unknown }).Title;
    return { ...paper, metadata: { ...paper.metadata, ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}) }, pages,
      sources: pages.filter(page => page.text).map(page => ({ id: crypto.randomUUID(), kind: 'text', pageNumber: page.pageNumber, textQuote: page.text.slice(0, 240) })),
    };
  }
  async render(pageNumber: number, canvas: HTMLCanvasElement, edge: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const pdf = await this.getDocument();
    const page = await pdf.getPage(pageNumber);
    signal.throwIfAborted();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: edge / Math.max(base.width, base.height) });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvas, viewport });
    const cancel = () => task.cancel();
    this.renders.add(task); signal.addEventListener('abort', cancel, { once: true });
    try { await task.promise; signal.throwIfAborted(); }
    finally { this.renders.delete(task); signal.removeEventListener('abort', cancel); }
  }
  async imageRegions(pageNumber: number): Promise<BBox[]> {
    const pdf = await this.getDocument();
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const operators = await page.getOperatorList();
    const stack: number[][] = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    const regions: BBox[] = [];
    const multiply = (left: number[], right: number[]) => [
      left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
      left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
      left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5],
    ];
    const point = (transform: number[], x: number, y: number) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
    for (let index = 0; index < operators.fnArray.length; index++) {
      const fn = operators.fnArray[index]; const args = operators.argsArray[index] as unknown[] | null;
      if (fn === OPS.save) stack.push([...matrix]);
      else if (fn === OPS.restore) matrix = stack.pop() ?? matrix;
      else if (fn === OPS.transform && args?.length === 6) matrix = multiply(matrix, args as number[]);
      else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && args && args.length >= 3) {
        const width = Number(args[1]); const height = Number(args[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
        // PDF.js applies the current transform to the image unit square; args[1/2] are source pixels.
        const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => {
          const [pointX, pointY] = point(matrix, x, y); return viewport.convertToViewportPoint(pointX, pointY);
        });
        const x = Math.max(0, Math.min(...points.map(item => item[0])) / viewport.width);
        const y = Math.max(0, Math.min(...points.map(item => item[1])) / viewport.height);
        const right = Math.min(1, Math.max(...points.map(item => item[0])) / viewport.width);
        const bottom = Math.min(1, Math.max(...points.map(item => item[1])) / viewport.height);
        if (right - x > .03 && bottom - y > .03) regions.push(BBoxSchema.parse({ x, y, width: right - x, height: bottom - y }));
      }
    }
    page.cleanup();
    return regions;
  }
  async image(paper: Paper, element: Extract<Element, { type: 'figure' }>, edge = PDF_PREVIEW_EDGE) {
    const source = figureSource(paper, { figureId: element.figureId, panelId: element.panelId }); const box = BBoxSchema.parse(element.cropOverride ?? source.bbox);
    const key = JSON.stringify([source.id, source.pageNumber, box, edge]);
    let result = this.images.get(key);
    if (!result) {
      result = (async () => {
        const canvas = document.createElement('canvas');
        try { await this.render(source.pageNumber, canvas, edge, new AbortController().signal); return cropCanvas(canvas, box); }
        finally { canvas.width = 0; canvas.height = 0; }
      })();
      this.images.set(key, result);
      void result.catch(() => { if (this.images.get(key) === result) this.images.delete(key); });
      if (this.images.size > IMAGE_CACHE_SIZE) this.images.delete(this.images.keys().next().value!);
    }
    return result;
  }
  clearImages() { this.images.clear(); }
  async dispose() {
    this.disposed = true; this.images.clear(); this.renders.forEach(task => task.cancel());
    await this.loading?.destroy();
  }
}
export function cropCanvas(source: HTMLCanvasElement, input: BBox) {
  const box = BBoxSchema.parse(input); const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * box.width)); out.height = Math.max(1, Math.round(source.height * box.height));
  try {
    out.getContext('2d')!.drawImage(source, source.width * box.x, source.height * box.y, source.width * box.width, source.height * box.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } finally { out.width = 0; out.height = 0; }
}
