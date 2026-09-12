import type { SpeechPlan } from './index';
import { ContentError } from '../content';
/** Only split long segments at complete sentence boundaries; paragraph identity and every character are retained. */
export function paginateSpeech(input: SpeechPlan): SpeechPlan {
  const plan = structuredClone(input);
  for (const segment of [...plan.speech]) {
    if (segment.text.length <= 300) continue;
    const sentences: string[] = [];
    let start = 0;
    for (let i = 0; i < segment.text.length; i++) {
      const char = segment.text[i];
      if (/[。！？\n]/u.test(char) || (/[.!?]/.test(char) && /\s/.test(segment.text[i + 1] ?? ''))) {
        sentences.push(segment.text.slice(start, i + 1));
        start = i + 1;
      }
    }
    if (start < segment.text.length) sentences.push(segment.text.slice(start));
    const chunks: string[] = [];
    let chunk = '';
    for (const sentence of sentences) {
      if (chunk && chunk.length + sentence.length > 240) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += sentence;
    }
    if (chunk) chunks.push(chunk);
    if (chunks.length < 2) continue;
    const parts = chunks.map((text, index) => ({
      ...structuredClone(segment),
      id: index ? segment.id + '-pagepart-' + index : segment.id,
      text,
    }));
    const paragraph = plan.speechParagraphs.find((p) => p.id === segment.paragraphId)!;
    paragraph.segmentIds.splice(paragraph.segmentIds.indexOf(segment.id), 1, ...parts.map((s) => s.id));
    plan.speech.splice(
      plan.speech.findIndex((s) => s.id === segment.id),
      1,
      ...parts,
    );
  }
  assertPlanningContent(input, plan);
  return plan;
}
export function assertPlanningContent(before: SpeechPlan, after: SpeechPlan) {
  if (
    before.title !== after.title ||
    before.language !== after.language ||
    JSON.stringify(before.sections) !== JSON.stringify(after.sections) ||
    JSON.stringify(before.omissions) !== JSON.stringify(after.omissions) ||
    JSON.stringify(before.speechParagraphs.map((p) => [p.id, p.sectionId, p.purpose])) !==
      JSON.stringify(after.speechParagraphs.map((p) => [p.id, p.sectionId, p.purpose]))
  )
    throw new ContentError('planning-content', '页面规划不能改写已保存的讲述结构。');
  for (const paragraph of before.speechParagraphs) {
    const original = paragraph.segmentIds.map((id) => before.speech.find((s) => s.id === id)!);
    const next = after.speechParagraphs
      .find((p) => p.id === paragraph.id)!
      .segmentIds.map((id) => after.speech.find((s) => s.id === id)!);
    const references = (parts: typeof original, field: 'claimIds' | 'sourceIds') =>
      JSON.stringify([...new Set(parts.flatMap((s) => s[field]))].sort());
    if (
      original.map((s) => s.text).join('') !== next.map((s) => s.text).join('') ||
      references(original, 'claimIds') !== references(next, 'claimIds') ||
      references(original, 'sourceIds') !== references(next, 'sourceIds')
    )
      throw new ContentError('planning-speech', '分页必须保留每个段落的完整原文与证据关联。');
  }
}
