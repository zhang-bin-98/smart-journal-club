import { z } from 'zod';
import { BBoxSchema } from '../../shared/schema';

export const LayoutIds = ['title', 'text-only', 'figure-full', 'figure-text', 'two-figures', 'panel-grid'] as const;
export type LayoutId = typeof LayoutIds[number];
export const SlideKinds = ['title', 'background', 'question', 'method', 'result', 'summary', 'discussion', 'conclusion', 'custom'] as const;
export type SlideKind = typeof SlideKinds[number];

export const TextElementSchema = z.strictObject({ id: z.string().min(1), type: z.literal('text'), text: z.string() });
export const BulletListElementSchema = z.strictObject({ id: z.string().min(1), type: z.literal('bullet-list'), items: z.array(z.string()) });
export const FigureElementSchema = z.strictObject({ id: z.string().min(1), type: z.literal('figure'), figureId: z.string().min(1), panelId: z.string().optional(), cropOverride: BBoxSchema.optional() });
export const CitationElementSchema = z.strictObject({ id: z.string().min(1), type: z.literal('citation'), sourceIds: z.array(z.string().min(1)) });
export const SlideElementSchema = z.discriminatedUnion('type', [TextElementSchema, BulletListElementSchema, FigureElementSchema, CitationElementSchema]);
export type SlideElement = z.infer<typeof SlideElementSchema>;
export type Element = SlideElement;
export const SlideSchema = z.strictObject({ id: z.string().min(1), kind: z.enum(SlideKinds), title: z.string(), message: z.string().optional(), layoutId: z.enum(LayoutIds), elements: z.array(SlideElementSchema), claimIds: z.array(z.string()), sourceIds: z.array(z.string()) });
export type Slide = z.infer<typeof SlideSchema>;
export const DeckSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.string().min(1), paperId: z.string().min(1), revision: z.number().int().nonnegative(), title: z.string(), language: z.string().min(1), slides: z.array(SlideSchema), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() });
export type Deck = z.infer<typeof DeckSchema>;

export const RevisionScopeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('element'), slideId: z.string().min(1), elementId: z.string().min(1) }),
  z.strictObject({ type: z.literal('slides'), slideIds: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ type: z.literal('deck') }),
]);
export type RevisionScope = z.infer<typeof RevisionScopeSchema>;

const SlideChangesSchema = z.strictObject({
  kind: z.enum(SlideKinds).optional(), title: z.string().optional(), message: z.string().optional(),
  layoutId: z.enum(LayoutIds).optional(), claimIds: z.array(z.string()).optional(), sourceIds: z.array(z.string()).optional(),
}).partial();
export const DeckMutationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add-slide'), slide: SlideSchema, afterSlideId: z.string().min(1).nullable() }),
  z.strictObject({ type: z.literal('delete-slide'), slideId: z.string().min(1) }),
  z.strictObject({ type: z.literal('move-slide'), slideId: z.string().min(1), afterSlideId: z.string().min(1).nullable() }),
  z.strictObject({ type: z.literal('update-slide'), slideId: z.string().min(1), changes: SlideChangesSchema }),
  z.strictObject({ type: z.literal('add-element'), slideId: z.string().min(1), element: SlideElementSchema }),
  z.strictObject({ type: z.literal('replace-element'), slideId: z.string().min(1), element: SlideElementSchema }),
  z.strictObject({ type: z.literal('delete-element'), slideId: z.string().min(1), elementId: z.string().min(1) }),
  z.strictObject({ type: z.literal('set-language'), language: z.string().trim().min(1) }),
]);
export type DeckMutation = z.infer<typeof DeckMutationSchema>;

export const ApplyRevisionArgsSchema = z.strictObject({
  scope: RevisionScopeSchema,
  mutations: z.array(DeckMutationSchema).min(1),
  summary: z.string().trim().min(1),
});
export type ApplyRevisionArgs = z.infer<typeof ApplyRevisionArgsSchema>;

export const RevisionRequestSchema = z.strictObject({ requestId: z.string().min(1), projectId: z.string().min(1), deckId: z.string().min(1), baseRevision: z.number().int().nonnegative() });
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
export const RevisionRecordSchema = z.strictObject({
  id: z.string().min(1), projectId: z.string().min(1), deckId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(), committedRevision: z.number().int().positive(),
  scope: RevisionScopeSchema, affectedSlideIds: z.array(z.string()), summary: z.string().min(1), createdAt: z.number().int().nonnegative(),
});
export type RevisionRecord = z.infer<typeof RevisionRecordSchema>;
