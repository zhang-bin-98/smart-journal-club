import { z } from 'zod';

export const BBoxSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }).superRefine((box, ctx) => {
  if (box.x < 0 || box.y < 0 || box.x >= 1 || box.y >= 1 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) ctx.addIssue({ code: 'custom', message: 'bbox 必须在页面范围内' });
});
export type BBox = z.infer<typeof BBoxSchema>;
export const LayoutIds = ['title', 'text-only', 'figure-full', 'figure-text', 'two-figures', 'panel-grid'] as const;
export type LayoutId = typeof LayoutIds[number];
export const SlideKinds = ['title', 'background', 'question', 'method', 'result', 'summary', 'discussion', 'conclusion', 'custom'] as const;
export type SlideKind = typeof SlideKinds[number];

export const SourceReferenceSchema = z.object({ id: z.string().min(1), kind: z.enum(['text', 'figure', 'panel', 'caption']), pageNumber: z.number().int().positive(), bbox: BBoxSchema.optional(), textQuote: z.string().optional() });
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export const FigurePanelSchema = z.object({ id: z.string().min(1), label: z.string().optional(), sourceId: z.string().min(1), description: z.string().optional() });
export type FigurePanel = z.infer<typeof FigurePanelSchema>;
export const FigureRefSchema = z.object({ id: z.string().min(1), label: z.string().optional(), caption: z.string().optional(), sourceId: z.string().min(1), description: z.string().optional(), panels: z.array(FigurePanelSchema) });
export type FigureRef = z.infer<typeof FigureRefSchema>;
export const PaperSchema = z.object({ schemaVersion: z.literal(1), id: z.string().min(1), metadata: z.object({ title: z.string().optional() }), pages: z.array(z.object({ pageNumber: z.number().int().positive(), width: z.number().positive(), height: z.number().positive(), text: z.string() })), sources: z.array(SourceReferenceSchema), figures: z.array(FigureRefSchema), claims: z.array(z.unknown()), evidences: z.array(z.unknown()) });
export type Paper = z.infer<typeof PaperSchema>;

const TextElementSchema = z.object({ id: z.string().min(1), type: z.literal('text'), text: z.string() });
const BulletListElementSchema = z.object({ id: z.string().min(1), type: z.literal('bullet-list'), items: z.array(z.string()) });
const FigureElementSchema = z.object({ id: z.string().min(1), type: z.literal('figure'), figureId: z.string().min(1), panelId: z.string().optional(), cropOverride: BBoxSchema.optional() });
const CitationElementSchema = z.object({ id: z.string().min(1), type: z.literal('citation'), sourceIds: z.array(z.string().min(1)) });
export const SlideElementSchema = z.discriminatedUnion('type', [TextElementSchema, BulletListElementSchema, FigureElementSchema, CitationElementSchema]);
export type SlideElement = z.infer<typeof SlideElementSchema>;
export type Element = SlideElement;
export const SlideSchema = z.object({ id: z.string().min(1), kind: z.enum(SlideKinds), title: z.string(), message: z.string().optional(), layoutId: z.enum(LayoutIds), elements: z.array(SlideElementSchema), claimIds: z.array(z.string()), sourceIds: z.array(z.string()) });
export type Slide = z.infer<typeof SlideSchema>;
export const DeckSchema = z.object({ schemaVersion: z.literal(1), id: z.string().min(1), paperId: z.string().min(1), revision: z.number().int().nonnegative(), title: z.string(), language: z.string().min(1), slides: z.array(SlideSchema), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() });
export type Deck = z.infer<typeof DeckSchema>;
