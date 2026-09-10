import { z } from 'zod';

export const ClaimSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  strength: z.enum(['descriptive', 'associative', 'supportive', 'causal']),
  importance: z.enum(['primary', 'secondary']),
  evidenceIds: z.array(z.string().min(1)),
});
export type Claim = z.infer<typeof ClaimSchema>;
export const EvidenceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const StoryTopics = [
  'background',
  'knowledgeGap',
  'question',
  'studyDesign',
  'mainFindings',
  'novelty',
  'limitations',
  'conclusion',
] as const;
export const StoryPointSchema = z.strictObject({
  text: z.string().min(1),
  claimIds: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)),
});
export const StorySchema = z.record(z.enum(StoryTopics), z.array(StoryPointSchema));
export const StudyProfileSchema = z.strictObject({
  type: z.string().min(1),
  designSummary: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});
