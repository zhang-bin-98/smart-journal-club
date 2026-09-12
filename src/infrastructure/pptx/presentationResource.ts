import { PdfResource } from '../pdf/pdfResource';
import { exportDeck } from './export';
import { figureSource } from '../../modules/paper/sources';
import type { ExportPort } from '../../app/presentation/exportPresentation';
/** Images are prepared serially from each source's own PDF; no partial deck is downloaded. */
export const exportWithResources: ExportPort = async (input) => {
  const resources = new Map<string, PdfResource>();
  let completed = 0;
  const total = input.deck.slides.reduce((sum, s) => sum + s.elements.filter((e) => e.type === 'figure').length, 0);
  const cancel = () => {
    for (const resource of resources.values()) void resource.dispose();
  };
  input.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await exportDeck(
      input.deck,
      input.paper,
      async (element) => {
        input.signal.throwIfAborted();
        const source = figureSource(input.paper, element);
        const documentId = 'documentId' in source ? (source.documentId as string) : '';
        let resource = resources.get(documentId);
        if (!resource) {
          const asset = input.assets[documentId];
          if (!asset) throw new Error('当前图源的 PDF 文件缺失。');
          resource = new PdfResource(asset.blob);
          resources.set(documentId, resource);
        }
        const image = await resource.image(source, element.cropOverride ?? source.bbox!, 2800);
        input.onStage?.('正在准备图像 ' + ++completed + '/' + total);
        return image;
      },
      input.signal,
    );
  } finally {
    input.signal.removeEventListener('abort', cancel);
    for (const resource of resources.values()) await resource.dispose();
  }
};
