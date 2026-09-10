import { z } from 'zod';
import { BBoxSchema, containsBBox } from '../../shared/schema';
export const FigurePageSchema = z
  .strictObject({
    figures: z.array(
      z.strictObject({
        label: z.string().min(1),
        caption: z.string(),
        description: z.string(),
        bbox: BBoxSchema,
        panels: z.array(
          z.strictObject({
            label: z.string().min(1),
            description: z.string(),
            bbox: BBoxSchema.describe(
              '必填：此 Panel 在完整 PDF 页中的 x/y/width/height 归一化矩形；x+width <= 1 且 y+height <= 1。无法确定坐标则不返回该 Panel。',
            ),
          }),
        ),
      }),
    ),
  })
  .superRefine((result, context) => {
    result.figures.forEach((figure, figureIndex) => {
      figure.panels.forEach((panel, panelIndex) => {
        if (!containsBBox(figure.bbox, panel.bbox))
          context.addIssue({
            code: 'custom',
            path: ['figures', figureIndex, 'panels', panelIndex, 'bbox'],
            message: 'Panel 必须完整包含于所属 Figure 图块；重新核对并保留科学标注，必要时扩大整图边界。',
          });
      });
    });
  });
