import { z } from 'zod';
import { BBoxSchema } from '../../shared/schema';

const identity = z.string().min(1);
const pageNumber = z.number().int().positive();
export const PaperDocumentSchema = z.strictObject({
  id: identity,
  role: z.enum(['primary', 'supplement']),
  fileName: identity,
  pdfAssetId: identity,
  pageCount: pageNumber.optional(),
});
export const TextBlockSchema = z.strictObject({
  id: identity,
  documentId: identity,
  pageNumber,
  kind: z.enum(['heading', 'paragraph', 'caption', 'table', 'other']),
  text: z.string(),
});
export const SourceReferenceSchema = z.strictObject({
  id: identity,
  documentId: identity,
  kind: z.enum(['text', 'figure', 'panel', 'caption']),
  pageNumber,
  bbox: BBoxSchema.optional(),
  textSpan: z
    .strictObject({ blockId: identity, start: z.number().int().nonnegative(), end: z.number().int().positive() })
    .optional(),
  textQuote: z.string().optional(),
  geometryOrigin: z.enum(['automatic', 'manual']).optional(),
});
export const MetadataSchema = z.strictObject({
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  journal: z.string().optional(),
  year: z.number().int().optional(),
  doi: z.string().optional(),
});
export const PaperPageSchema = z.strictObject({
  documentId: identity,
  pageNumber,
  width: z.number().positive(),
  height: z.number().positive(),
  blockIds: z.array(identity),
});
export type PaperDocument = z.infer<typeof PaperDocumentSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type PaperPage = z.infer<typeof PaperPageSchema>;
