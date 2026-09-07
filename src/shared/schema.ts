import { z } from 'zod';

/** PDF 原页旋转后整页坐标系的归一化矩形；来源、裁图覆盖与布局换算共用同一契约。 */
export const BBoxSchema = z
  .strictObject({
    x: z.number().finite().min(0).lt(1),
    y: z.number().finite().min(0).lt(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .superRefine((box, ctx) => {
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x >= 1 ||
      box.y >= 1 ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x + box.width > 1 ||
      box.y + box.height > 1
    )
      ctx.addIssue({ code: 'custom', message: 'bbox 必须在页面范围内' });
  })
  .describe(
    '完整 PDF 页的归一化矩形：x/y 是左上角，width/height 是宽高；x+width <= 1 且 y+height <= 1，不使用像素或右下角坐标。',
  );
export type BBox = z.infer<typeof BBoxSchema>;
