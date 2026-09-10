import { reconstructTextBlocks, type PdfTextItem } from './textBlocks';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; items: PdfTextItem[] }>) => void) | null;
  postMessage: (message: unknown) => void;
};

worker.onmessage = ({ data }) => {
  try {
    worker.postMessage({ id: data.id, result: reconstructTextBlocks(data.items) });
  } catch {
    worker.postMessage({ id: data.id, error: 'PDF 文本块重建失败，请重试此页' });
  }
};
