import type { Paper } from '../../paper/model';
import { ContentSchema, ContentError, type Content } from './schema';

export function contentOf(value: Content): Content {
  const { title, language, sections, speechParagraphs, speech, omissions } = value;
  return ContentSchema.parse({ title, language, sections, speechParagraphs, speech, omissions });
}
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new ContentError('duplicate-id', `${label}身份重复。`);
}
/** 正文仅存在 speech；段落持有有序片段身份，反向证据查询始终派生。 */
export function validateContent(
  input: unknown,
  paper: { claims: { id: string }[]; sources: { id: string }[] },
): Content {
  const result = ContentSchema.safeParse(input);
  if (!result.success) throw new ContentError('invalid-content', '讲稿结构不完整，请重新生成或重试修改。');
  const value = result.data;
  unique(
    value.sections.map((s) => s.id),
    '章节',
  );
  unique(
    value.speechParagraphs.map((s) => s.id),
    '段落',
  );
  unique(
    value.speech.map((s) => s.id),
    '片段',
  );
  const sections = new Set(value.sections.map((s) => s.id));
  const segments = new Map(value.speech.map((s) => [s.id, s]));
  const sources = new Set(paper.sources.map((s) => s.id));
  const claims = new Set(paper.claims.map((s) => s.id));
  const used: string[] = [];
  for (const paragraph of value.speechParagraphs) {
    if (!sections.has(paragraph.sectionId)) throw new ContentError('missing-section', '讲述所属章节不存在。');
    for (const id of paragraph.segmentIds) {
      if (segments.get(id)?.paragraphId !== paragraph.id)
        throw new ContentError('missing-segment', '讲述片段归属不一致。');
      used.push(id);
    }
  }
  unique(used, '讲述分配');
  if (used.length !== value.speech.length) throw new ContentError('orphan-segment', '有未归属段落的正文。');
  for (const segment of value.speech) {
    unique(segment.sourceIds, '证据引用');
    unique(segment.claimIds, '发现引用');
    if (segment.sourceIds.some((id) => !sources.has(id)) || segment.claimIds.some((id) => !claims.has(id)))
      throw new ContentError('missing-reference', '讲述引用的发现或来源已不存在。', {
        segmentId: segment.id,
        invalidSourceIds: segment.sourceIds.filter((id) => !sources.has(id)),
        invalidClaimIds: segment.claimIds.filter((id) => !claims.has(id)),
      });
  }
  unique(
    value.omissions.map((s) => s.claimId),
    '省略记录',
  );
  if (value.omissions.some((item) => !claims.has(item.claimId)))
    throw new ContentError('missing-claim', '省略的发现不存在。');
  return value;
}
export function paragraphText(content: Content, paragraphId: string) {
  const paragraph = content.speechParagraphs.find((p) => p.id === paragraphId);
  return paragraph?.segmentIds.map((id) => content.speech.find((s) => s.id === id)?.text ?? '').join('') ?? '';
}
export function paragraphSources(content: Content, paragraphId: string) {
  return [...new Set(content.speech.filter((s) => s.paragraphId === paragraphId).flatMap((s) => s.sourceIds))];
}
export function uncoveredClaims(content: Content, paper: Paper) {
  const covered = new Set(content.speech.filter((s) => s.text.trim()).flatMap((s) => s.claimIds));
  return paper.claims.filter((claim) => !covered.has(claim.id));
}
/** 用户删除/改写才记录此前覆盖而本次不再覆盖的发现；自动遗漏保持独立。 */
export function recordUserOmissions(before: Content, next: Content, paper: Paper) {
  const previouslyCovered = new Set(before.speech.filter((s) => s.text.trim()).flatMap((s) => s.claimIds));
  const missing = new Set(uncoveredClaims(next, paper).map((c) => c.id));
  next.omissions = next.omissions.filter((item) => missing.has(item.claimId));
  for (const claimId of previouslyCovered) {
    if (missing.has(claimId) && !next.omissions.some((o) => o.claimId === claimId))
      next.omissions.push({ claimId, reason: '用户编辑或删除讲述', origin: 'user' });
  }
}
