import { z } from 'zod';
import { FigureGroupSchema, SlideSchema, SlideElementSchema, SlideKinds, LayoutIds } from '../content/page';
export * from '../content/page';
import { SpeechParagraphSchema, SpeechSegmentSchema, OmissionSchema, SectionKinds, SectionSchema } from '../content';

export { SectionKinds } from '../content';
export type SectionKind = (typeof SectionKinds)[number];

export const DeckSectionSchema = SectionSchema.omit({ track: true }).extend({
  track: z.enum(['main', 'supplement']).optional(),
});
export type DeckSection = z.infer<typeof DeckSectionSchema>;

export const DeckSchemaVersion = 2;
export const DeckSchema = z
  .strictObject({
    schemaVersion: z.union([z.literal(DeckSchemaVersion), z.literal(3)]),
    id: z.string().min(1),
    paperId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    title: z.string(),
    language: z.string().min(1),
    sections: z.array(DeckSectionSchema),
    paperRevision: z.number().int().nonnegative().optional(),
    speechParagraphs: z.array(SpeechParagraphSchema).optional(),
    speech: z.array(SpeechSegmentSchema).optional(),
    omissions: z.array(OmissionSchema).optional(),
    slides: z.array(SlideSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((deck, context) => {
    if (deck.schemaVersion !== 3) return;
    for (const field of ['paperRevision', 'speechParagraphs', 'speech', 'omissions'] as const) {
      if (deck[field] === undefined)
        context.addIssue({ code: 'custom', path: [field], message: '新版讲述稿必须保留完整内容字段。' });
    }
    deck.sections.forEach((section, index) => {
      if (!section.track)
        context.addIssue({ code: 'custom', path: ['sections', index, 'track'], message: '章节需要主线或补充归属。' });
    });
    deck.slides.forEach((slide, index) => {
      if (!slide.speechIds)
        context.addIssue({ code: 'custom', path: ['slides', index, 'speechIds'], message: '页面需要显式讲稿分配。' });
    });
  });
export type Deck = z.infer<typeof DeckSchema>;

export const RevisionScopeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('element'), slideId: z.string().min(1), elementId: z.string().min(1) }),
  z.strictObject({ type: z.literal('slides'), slideIds: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ type: z.literal('deck') }),
]);
export type RevisionScope = z.infer<typeof RevisionScopeSchema>;

const SlideChangesSchema = z
  .strictObject({
    kind: z.enum(SlideKinds).optional(),
    title: z.string().optional(),
    purpose: z.string().optional(),
    message: z.string().optional(),
    layoutId: z.enum(LayoutIds).optional(),
    figureGroup: FigureGroupSchema.nullable().optional(),
    speechIds: z.array(z.string()).optional(),
    claimIds: z.array(z.string()).optional(),
    sourceIds: z.array(z.string()).optional(),
  })
  .partial();
export const DeckMutationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add-slide'), slide: SlideSchema, afterSlideId: z.string().min(1).nullable() }),
  z.strictObject({ type: z.literal('delete-slide'), slideId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('move-slide'),
    slideId: z.string().min(1),
    targetSectionId: z.string().min(1),
    afterSlideId: z.string().min(1).nullable(),
  }),
  z.strictObject({ type: z.literal('update-slide'), slideId: z.string().min(1), changes: SlideChangesSchema }),
  z.strictObject({ type: z.literal('add-element'), slideId: z.string().min(1), element: SlideElementSchema }),
  z.strictObject({ type: z.literal('replace-element'), slideId: z.string().min(1), element: SlideElementSchema }),
  z.strictObject({ type: z.literal('delete-element'), slideId: z.string().min(1), elementId: z.string().min(1) }),
  z.strictObject({ type: z.literal('set-language'), language: z.string().trim().min(1) }),
  z.strictObject({ type: z.literal('edit-speech'), segmentId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal('split-speech'),
    segmentId: z.string(),
    offset: z.number().int().positive(),
    newId: z.string(),
  }),
]);
export type DeckMutation = z.infer<typeof DeckMutationSchema>;

export const ApplyRevisionArgsSchema = z.strictObject({
  scope: RevisionScopeSchema,
  mutations: z.array(DeckMutationSchema).min(1),
  summary: z.string().trim().min(1),
});
export type ApplyRevisionArgs = z.infer<typeof ApplyRevisionArgsSchema>;

export const RevisionRequestSchema = z.strictObject({
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
});
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
export const RevisionRecordSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  committedRevision: z.number().int().positive(),
  scope: RevisionScopeSchema,
  affectedSlideIds: z.array(z.string()),
  summary: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type RevisionRecord = z.infer<typeof RevisionRecordSchema>;
