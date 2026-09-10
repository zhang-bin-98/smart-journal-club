import type { BBox } from '../../shared/schema';
import type { PixelResult } from '../../modules/paper/figurePixels';
export type FigureBitmap = { canvas: HTMLCanvasElement; release: () => void };
export type FigureResources = {
  acquire(documentId: string, pageNumber: number, signal: AbortSignal): Promise<FigureBitmap>;
  local(
    documentId: string,
    pageNumber: number,
    bbox: BBox,
    signal: AbortSignal,
  ): Promise<{ image: string; refine: (boxes: BBox[]) => Promise<PixelResult>; release: () => void }>;
  dispose(): void;
};
