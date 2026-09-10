import type { z } from 'zod';
import type { StorySchema, StudyProfileSchema } from '../../modules/paper/evidence';
import type { Paper } from '../../modules/paper/model';

/** 请求内短引用只节省传输，不修改底稿、科学正文或跨文件关系。 */
export function createSummaryContext(paper: Paper) {
  const aliases = new Map<string, string>();
  const originals = new Map<string, string>();
  const register = (id: string, alias: string) => {
    aliases.set(id, alias);
    originals.set(alias, id);
  };
  for (const [index, claim] of paper.claims.entries()) register(claim.id, `c${index}`);
  for (const [index, evidence] of paper.evidences.entries()) register(evidence.id, `e${index}`);
  for (const [index, source] of paper.sources.entries()) {
    register(
      source.id,
      `d${paper.documents.findIndex((doc) => doc.id === source.documentId)}p${source.pageNumber}s${index}`,
    );
  }
  const alias = (id: string) => aliases.get(id) ?? id;
  const original = (id: string) => originals.get(id) ?? id;
  return {
    shortId: alias,
    data: {
      referenceFormat:
        'c 为发现，e 为证据；Source d0p2s3 表示 documents[0] 文件内第 2 页。请原样引用短 ID，由程序还原。',
      documents: paper.documents,
      metadata: paper.metadata,
      claims: paper.claims.map((claim) => ({
        ...claim,
        id: alias(claim.id),
        evidenceIds: claim.evidenceIds.map(alias),
      })),
      evidences: paper.evidences.map((evidence) => ({
        ...evidence,
        id: alias(evidence.id),
        sourceIds: evidence.sourceIds.map(alias),
      })),
      primaryOpening: paper.blocks
        .filter(
          (block) =>
            block.documentId === paper.documents.find((doc) => doc.role === 'primary')?.id && block.pageNumber === 1,
        )
        .map((block) => block.text),
    },
    restore<T extends { studyProfile: z.infer<typeof StudyProfileSchema>; story: z.infer<typeof StorySchema> }>(
      result: T,
    ): T {
      return {
        ...result,
        studyProfile: { ...result.studyProfile, sourceIds: result.studyProfile.sourceIds.map(original) },
        story: Object.fromEntries(
          Object.entries(result.story).map(([topic, points]) => [
            topic,
            points.map((point) => ({
              ...point,
              claimIds: point.claimIds.map(original),
              sourceIds: point.sourceIds.map(original),
            })),
          ]),
        ) as T['story'],
      };
    },
  };
}
