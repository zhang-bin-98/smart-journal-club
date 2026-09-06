import type { PdfResource } from '../../shared/pdf/pdfResource';
import type { Paper } from './paper.schema';

/** 从原 PDF 提取页文本与文字来源并组装论文解析产物；扫描件等无法解析时保留项目并提示更换版本。 */
export async function parsePaper(resource: PdfResource, paper: Paper, signal: AbortSignal): Promise<Paper> {
  const pages = await resource.pageTexts(signal);
  if (pages.reduce((total, page) => total + page.text.length, 0) < 100) throw new Error('未提取到足够文字，扫描件暂不支持，请更换可解析版本');
  const title = await resource.documentTitle();
  return { ...paper, metadata: { ...paper.metadata, ...(title ? { title } : {}) }, pages,
    sources: pages.filter(page => page.text).map(page => ({ id: crypto.randomUUID(), kind: 'text', pageNumber: page.pageNumber, textQuote: page.text.slice(0, 240) })),
  };
}
