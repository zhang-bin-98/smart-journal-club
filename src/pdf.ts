import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { BBox } from './types';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function renderPdf(buffer: ArrayBuffer, canvas: HTMLCanvasElement) { const pdf = await getDocument({ data: buffer }).promise; const page = await pdf.getPage(1); const viewport = page.getViewport({ scale: 1.4 }); canvas.width = viewport.width; canvas.height = viewport.height; await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise; const text = await page.getTextContent(); return { pages: pdf.numPages, width: viewport.width, height: viewport.height, text: text.items.map(item => 'str' in item ? item.str : '').join(' ') }; }
export function cropCanvas(source: HTMLCanvasElement, box: BBox) { const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(source.width * box.width)); out.height = Math.max(1, Math.round(source.height * box.height)); out.getContext('2d')!.drawImage(source, source.width * box.x, source.height * box.y, out.width, out.height, 0, 0, out.width, out.height); return out.toDataURL('image/png'); }
