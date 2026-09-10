import { BBoxSchema, type BBox } from '../../shared/schema';

/** Local normalized crop coordinates map to the rotated PDF page, independent of display scale. */
export function toPageBox(local: BBox, region: BBox): BBox {
  return BBoxSchema.parse({
    x: region.x + local.x * region.width,
    y: region.y + local.y * region.height,
    width: local.width * region.width,
    height: local.height * region.height,
  });
}

export function toLocalBox(box: BBox, region: BBox): BBox {
  return {
    x: (box.x - region.x) / region.width,
    y: (box.y - region.y) / region.height,
    width: box.width / region.width,
    height: box.height / region.height,
  };
}

export function moveBox(box: BBox, dx: number, dy: number, bounds: BBox): BBox {
  return {
    ...box,
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - box.width, box.x + dx)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - box.height, box.y + dy)),
  };
}

export function resizeBox(box: BBox, handle: string, dx: number, dy: number, bounds: BBox): BBox {
  const minimum = 0.002;
  let { x, y } = box;
  let right = x + box.width;
  let bottom = y + box.height;
  if (handle.includes('w')) x = Math.max(bounds.x, Math.min(right - minimum, x + dx));
  if (handle.includes('e')) right = Math.min(bounds.x + bounds.width, Math.max(x + minimum, right + dx));
  if (handle.includes('n')) y = Math.max(bounds.y, Math.min(bottom - minimum, y + dy));
  if (handle.includes('s')) bottom = Math.min(bounds.y + bounds.height, Math.max(y + minimum, bottom + dy));
  return { x, y, width: right - x, height: bottom - y };
}

export const pageBounds: BBox = { x: 0, y: 0, width: 1, height: 1 };
