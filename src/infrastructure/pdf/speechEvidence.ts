import type { SpeechWorkspace } from '../../app/presentation/ports';
import { openProject } from '../persistence/projectStore';
import { createFigureResources } from './figureResource';
import { ContentError } from '../../modules/presentation/content';
/** 有界逐图读取，以原像素提供图证据；缓存和位图在 finally 释放。 */
export async function speechEvidence(data: SpeechWorkspace, signal: AbortSignal) {
  const opened = await openProject(data.project.id);
  const resources = createFigureResources(opened);
  const regions = data.paper.figures.flatMap((figure) => figure.regions.map((region) => ({ figure, region })));
  if (!regions.length) {
    resources.dispose();
    return undefined;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  const cell = 900;
  canvas.height = Math.ceil(regions.length / 2) * cell;
  if (canvas.height > 16000) {
    resources.dispose();
    throw new ContentError('evidence-capacity', '本次图证据过多，需分批讲述生成。');
  }
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    for (const [index, { figure, region }] of regions.entries()) {
      signal.throwIfAborted();
      const source = data.paper.sources.find((s) => s.id === region.sourceId)!;
      if (!source.bbox) throw new ContentError('missing-image', '图证据边界缺失，请返回图源核对。');
      const bitmap = await resources.acquire(source.documentId, source.pageNumber, signal);
      try {
        const box = source.bbox;
        const x = (index % 2) * cell;
        const y = Math.floor(index / 2) * cell;
        const sw = box.width * bitmap.canvas.width;
        const sh = box.height * bitmap.canvas.height;
        const scale = Math.min((cell - 20) / sw, (cell - 65) / sh);
        ctx.fillStyle = 'black';
        ctx.font = '18px Arial';
        ctx.fillText((figure.label ?? 'Figure') + ' | ' + region.sourceId, x + 10, y + 24, cell - 20);
        ctx.drawImage(
          bitmap.canvas,
          box.x * bitmap.canvas.width,
          box.y * bitmap.canvas.height,
          sw,
          sh,
          x + 10,
          y + 50,
          sw * scale,
          sh * scale,
        );
      } finally {
        bitmap.release();
      }
    }
    return canvas.toDataURL('image/png');
  } finally {
    resources.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }
}
