import { z } from 'zod';

/** PDF 原页旋转后整页坐标系的归一化矩形；来源、裁图覆盖与布局换算共用同一契约。 */
export const BBoxSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }).superRefine((box, ctx) => {
  if (box.x < 0 || box.y < 0 || box.x >= 1 || box.y >= 1 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) ctx.addIssue({ code: 'custom', message: 'bbox 必须在页面范围内' });
});
export type BBox = z.infer<typeof BBoxSchema>;
export function validateBBox(box: BBox) { return Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1; }
