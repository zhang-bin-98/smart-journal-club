import type { PaperResource } from '../../app/paper/ports';
import { PdfResource, PDF_PREVIEW_EDGE } from './pdfResource';

/** One adapter is owned by the project session for each fixed document resource. */
export function createAnalysisResource(blob: Blob): PaperResource {
  const resource = new PdfResource(blob);
  const encodePage = async (pageNumber: number, edge: number, signal: AbortSignal) => {
    const canvas = document.createElement('canvas');
    try {
      await resource.render(pageNumber, canvas, edge, signal);
      signal.throwIfAborted();
      return canvas.toDataURL('image/png');
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  };
  return {
    pageCount: async () => (await resource.getDocument()).numPages,
    title: () => resource.documentTitle(),
    text: (pageNumber, signal) => resource.pageText(pageNumber, signal),
    discover: async (pageNumber, signal) => ({
      hasImages: (await resource.imageRegions(pageNumber, signal)).length > 0,
    }),
    figureInput: async (pageNumber, signal) => {
      const imageRegions = await resource.imageRegions(pageNumber, signal);
      const image = await encodePage(pageNumber, 1800, signal);
      return { image, imageRegions };
    },
    preview: (pageNumber, signal) => encodePage(pageNumber, PDF_PREVIEW_EDGE, signal),
    dispose: () => resource.dispose(),
  };
}
