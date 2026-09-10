import type { BBox } from '../../shared/schema';
export type PixelInput = { width: number; height: number; data: Uint8ClampedArray; boxes: BBox[] };
export type PixelResult = { boxes: BBox[]; issues: string[][] };
/** Conservative expansion toward nearby gaps; never erases pixels, shrinks crops or enforces non-overlap. */
export function refineFigurePixels(input: PixelInput): PixelResult {
  const { width, height, data } = input;
  if (width < 1 || height < 1 || width * height > 8_000_000 || data.length !== width * height * 4)
    throw new Error('像素任务尺寸无效');
  const ink = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const max = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const min = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    return data[offset + 3] > 20 && (min < 232 || max - min > 16);
  };
  const results = input.boxes.map((box) => {
    const issues: string[] = [];
    const original = [
      Math.floor(box.x * width),
      Math.floor(box.y * height),
      Math.ceil((box.x + box.width) * width) - 1,
      Math.ceil((box.y + box.height) * height) - 1,
    ];
    const limits = [0, 0, width - 1, height - 1];
    const edges = [...original];
    let total = 0;
    for (let y = original[1]; y <= original[3]; y++)
      for (let x = original[0]; x <= original[2]; x++) if (ink(x, y)) total++;
    if (total < 3) issues.push('疑似空框，请对照原页');
    for (let side = 0; side < 4; side++) {
      const vertical = side % 2 === 0;
      const from = vertical ? original[1] : original[0];
      const to = vertical ? original[3] : original[2];
      const direction = side < 2 ? -1 : 1;
      const density = (position: number) => {
        let count = 0;
        for (let i = from; i <= to; i++) if (ink(vertical ? position : i, vertical ? i : position)) count++;
        return count / Math.max(1, to - from + 1);
      };
      if (density(edges[side]) < 0.015) continue;
      const budget = Math.max(3, Math.round((vertical ? width : height) * 0.04));
      let gap = 0;
      let found = false;
      for (let step = 1; step <= budget; step++) {
        const position = original[side] + direction * step;
        if (position < 0 || position > limits[side + (side < 2 ? 2 : 0)]) break;
        gap = density(position) < 0.008 ? gap + 1 : 0;
        if (gap >= 2) {
          edges[side] = position;
          found = true;
          break;
        }
      }
      if (!found) issues.push('边缘经过内容，附近没有可靠间隙；请检查坐标或共享图例');
    }
    return {
      bbox: {
        x: edges[0] / width,
        y: edges[1] / height,
        width: (edges[2] + 1 - edges[0]) / width,
        height: (edges[3] + 1 - edges[1]) / height,
      },
      issues,
    };
  });
  return { boxes: results.map((result) => result.bbox), issues: results.map((result) => result.issues) };
}
