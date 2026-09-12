import { z } from 'zod';
import { BBoxSchema } from '../../../shared/schema';
export type FigureGroupNode =
  | { kind: 'image'; imageId: string }
  | { kind: 'split'; direction: 'row' | 'column'; ratio: number; first: FigureGroupNode; second: FigureGroupNode };
export const FigureGroupNodeSchema: z.ZodType<FigureGroupNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('image'), imageId: z.string().min(1) }),
    z.strictObject({
      kind: z.literal('split'),
      direction: z.enum(['row', 'column']),
      ratio: z.number().min(0.1).max(0.9),
      first: FigureGroupNodeSchema,
      second: FigureGroupNodeSchema,
    }),
  ]),
);
export const FigureGroupSchema = z.strictObject({ root: FigureGroupNodeSchema, gapPt: z.number().min(0).max(36) });
export type FigureGroup = z.infer<typeof FigureGroupSchema>;
export const LayoutIds = ['title', 'text-only', 'figure-full', 'figure-text', 'two-figures', 'panel-grid'] as const;
export type LayoutId = (typeof LayoutIds)[number];
export const SlideKinds = [
  'title',
  'background',
  'question',
  'method',
  'result',
  'summary',
  'discussion',
  'conclusion',
  'custom',
] as const;
export type SlideKind = (typeof SlideKinds)[number];
export const TextElementSchema = z.strictObject({ id: z.string().min(1), type: z.literal('text'), text: z.string() });
export const BulletListElementSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('bullet-list'),
  items: z.array(z.string()),
});
export const FigureElementSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('figure'),
  figureId: z.string().min(1),
  regionId: z.string().optional(),
  panelId: z.string().optional(),
  cropOverride: BBoxSchema.optional(),
});
export const CitationElementSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('citation'),
  sourceIds: z.array(z.string().min(1)),
});
export const SlideElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  BulletListElementSchema,
  FigureElementSchema,
  CitationElementSchema,
]);
export type SlideElement = z.infer<typeof SlideElementSchema>;
export type Element = SlideElement;
export const SlideSchema = z.strictObject({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  kind: z.enum(SlideKinds),
  title: z.string(),
  purpose: z.string().optional(),
  message: z.string().optional(),
  layoutId: z.enum(LayoutIds),
  figureGroup: FigureGroupSchema.optional(),
  elements: z.array(SlideElementSchema),
  speechIds: z.array(z.string()).optional(),
  claimIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
});
export type Slide = z.infer<typeof SlideSchema>;
