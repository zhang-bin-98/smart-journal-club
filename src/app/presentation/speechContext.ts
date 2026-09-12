import type { Paper } from '../../modules/paper/model';
import type { Content } from '../../modules/presentation/content';
/** 请求内短索引减少长身份和重复恢复信息；原始科学正文与全部发现完整保留。 */
export function speechContext(paper: Paper, referencePaper = paper) {
  const ids = new Map<string, string>();
  const add = (kind: string, entries: { id: string }[]) =>
    entries.forEach((s, i) => {
      ids.set(s.id, kind + (i + 1));
    });
  add('d', referencePaper.documents);
  add('b', referencePaper.blocks);
  add('s', referencePaper.sources);
  add('c', referencePaper.claims);
  add('e', referencePaper.evidences);
  add('f', referencePaper.figures);
  add(
    'r',
    referencePaper.figures.flatMap((f) => f.regions),
  );
  add(
    'p',
    referencePaper.figures.flatMap((f) => f.regions.flatMap((r) => r.panels)),
  );
  const reverse = new Map([...ids].map(([long, short]) => [short, long]));
  function map(value: unknown, table: Map<string, string>): unknown {
    if (typeof value === 'string') return table.get(value) ?? value;
    if (Array.isArray(value)) return value.map((v) => map(v, table));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, map(v, table)]));
    return value;
  }
  const { documents, metadata, blocks, sources, figures, claims, evidences, studyProfile, story } = paper;
  const compactSources = sources.map((source) => {
    const block = blocks.find((block) => block.id === source.textSpan?.blockId);
    if (block && source.textSpan && block.text.slice(source.textSpan.start, source.textSpan.end) === source.textQuote) {
      const { textQuote: _duplicate, ...reference } = source;
      return reference;
    }
    return source;
  });
  const allowedClaims = new Set(claims.map((claim) => claim.id));
  const allowedSources = new Set(sources.map((source) => source.id));
  const localStory =
    story &&
    Object.fromEntries(
      Object.entries(story).map(([key, points]) => [
        key,
        points.map((point) => ({
          ...point,
          claimIds: point.claimIds.filter((id) => allowedClaims.has(id)),
          sourceIds: point.sourceIds.filter((id) => allowedSources.has(id)),
        })),
      ]),
    );
  const localProfile = studyProfile && {
    ...studyProfile,
    sourceIds: studyProfile.sourceIds.filter((id) => allowedSources.has(id)),
  };
  const context = map(
    {
      documents,
      metadata,
      blocks,
      sources: compactSources,
      figures,
      claims,
      evidences,
      studyProfile: localProfile,
      story: localStory,
    },
    ids,
  );
  return {
    context,
    claimIds: claims.map((claim) => ids.get(claim.id)!),
    sourceIds: sources.map((source) => ids.get(source.id)!),
    encodeDiagnostics: (value: unknown) => map(value, ids),
    decode(value: Content): Content {
      // 只映射科学引用，不能把模型自己的临时段落/章节身份误当来源。
      return {
        ...value,
        speech: value.speech.map((segment) => ({
          ...segment,
          sourceIds: segment.sourceIds.map((id) => reverse.get(id) ?? id),
          claimIds: segment.claimIds.map((id) => reverse.get(id) ?? id),
        })),
        omissions: value.omissions.map((item) => ({ ...item, claimId: reverse.get(item.claimId) ?? item.claimId })),
      };
    },
  };
}
