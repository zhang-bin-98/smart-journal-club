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
export const ClaimSchema = z.strictObject({ id: z.string().min(1), text: z.string().min(1), strength: z.enum(['descriptive', 'associative', 'supportive', 'causal']), importance: z.enum(['primary', 'secondary']), evidenceIds: z.array(z.string().min(1)) });
export type Claim = z.infer<typeof ClaimSchema>;
export const EvidenceSchema = z.strictObject({ id: z.string().min(1), kind: z.string().min(1), summary: z.string().min(1), sourceIds: z.array(z.string().min(1)).min(1) });
export type Evidence = z.infer<typeof EvidenceSchema>;
export const StoryTopics = ['background', 'knowledgeGap', 'question', 'studyDesign', 'mainFindings', 'novelty', 'limitations', 'conclusion'] as const;
export const StoryPointSchema = z.strictObject({ text: z.string().min(1), claimIds: z.array(z.string().min(1)), sourceIds: z.array(z.string().min(1)) });
export const StorySchema = z.record(z.enum(StoryTopics), z.array(StoryPointSchema));
export const StudyProfileSchema = z.strictObject({ type: z.string().min(1), designSummary: z.string().min(1), sourceIds: z.array(z.string().min(1)).min(1) });
export const MetadataSchema = z.strictObject({ title: z.string().optional(), authors: z.array(z.string()).optional(), journal: z.string().optional(), year: z.number().int().optional(), doi: z.string().optional() });
export const PaperSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.string().min(1), metadata: MetadataSchema, pages: z.array(z.strictObject({ pageNumber: z.number().int().positive(), width: z.number().positive(), height: z.number().positive(), text: z.string() })), sources: z.array(SourceReferenceSchema), figures: z.array(FigureRefSchema), studyProfile: StudyProfileSchema.optional(), story: StorySchema.optional(), claims: z.array(ClaimSchema), evidences: z.array(EvidenceSchema) });
export type Paper = z.infer<typeof PaperSchema>;

export const Checkpoints = ['project-created', 'pdf-parsed', 'figures-ready', 'paper-ready', 'deck-plan-ready', 'deck-ready'] as const;
export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), nameIsCustom: z.boolean().optional(), paperId: z.string().min(1), pdfAssetId: z.string().min(1),
  currentDeckId: z.string().optional(), previousDeckId: z.string().optional(), checkpoint: z.enum(Checkpoints),
  preferences: z.strictObject({ instruction: z.string(), language: z.string().optional(), targetSlides: z.number().int().positive().optional(), strategyId: z.string().optional() }),
  lastOpenedSlideId: z.string().optional(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type PdfAsset = { blob: Blob; name: string };

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
export const DeckPlanSchema = DeckSchema.pick({ schemaVersion: true, paperId: true, title: true, language: true }).extend({
  slides: z.array(SlideSchema.omit({ elements: true }).extend({ figures: z.array(FigureElementSchema.pick({ figureId: true, panelId: true })) })).min(1),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;

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

// 可见对话与修改记录共用 history store；不保存工具消息、Key 或撤销快照。
export type ChatMessage = {
  id: string; projectId: string; role: 'user' | 'assistant'; text: string; createdAt: number;
  deckId: string; baseRevision: number; revision?: number; summary?: string;
  affectedSlideIds?: string[]; targetSlideIds?: string[]; targetElementId?: string;
};
