import { z } from 'zod';

const id = z.string().min(1);
export const SectionKinds = [
  'opening',
  'background',
  'question',
  'study-design',
  'results',
  'synthesis',
  'limitations',
  'takeaways',
  'discussion',
  'custom',
] as const;
export const SectionSchema = z.strictObject({
  id,
  kind: z.enum(SectionKinds),
  track: z.enum(['main', 'supplement']),
  title: z.string(),
  purpose: z.string(),
  transitionToNext: z.string().optional(),
});
export const SpeechParagraphSchema = z.strictObject({
  id,
  sectionId: id,
  purpose: z.string(),
  segmentIds: z.array(id).min(1),
});
export const SpeechSegmentSchema = z.strictObject({
  id,
  paragraphId: id,
  text: z.string(),
  claimIds: z.array(id),
  sourceIds: z.array(id),
});
export const OmissionSchema = z.strictObject({ claimId: id, reason: z.string(), origin: z.literal('user') });
export const ContentSchema = z.strictObject({
  title: z.string(),
  language: id,
  sections: z.array(SectionSchema),
  speechParagraphs: z.array(SpeechParagraphSchema),
  speech: z.array(SpeechSegmentSchema),
  omissions: z.array(OmissionSchema),
});
export type Content = z.infer<typeof ContentSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type SpeechParagraph = z.infer<typeof SpeechParagraphSchema>;
export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;

export class ContentError extends Error {
  readonly stage = 'outline';
  readonly recovery = '保留已有讲稿，检查当前对象后重试。';
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics?: unknown,
  ) {
    super(message);
  }
}
