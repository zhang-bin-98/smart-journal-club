import { ContentError, type Content, type SpeechSegment } from './schema';
/** 正文片段按已保存分配派生备注，只有跨段落才补分隔，不保存第二份 notes。 */
export function notesText(speech: SpeechSegment[], ids: string[]) {
  const byId = new Map(speech.map((s) => [s.id, s]));
  let paragraphId: string | undefined;
  return ids
    .map((id) => {
      const segment = byId.get(id);
      if (!segment) throw new ContentError('missing-assignment', '页面讲稿分配引用不存在的片段。');
      const separator = paragraphId && paragraphId !== segment.paragraphId ? '\n\n' : '';
      paragraphId = segment.paragraphId;
      return separator + segment.text;
    })
    .join('');
}
export function validateSpeechAssignments(content: Content, slides: { speechIds?: string[] }[]) {
  const known = new Set(content.speech.map((s) => s.id));
  const used = new Set<string>();
  for (const slide of slides) {
    for (const id of slide.speechIds ?? []) {
      if (!known.has(id) || used.has(id))
        throw new ContentError('invalid-assignment', '页面有不存在或重复分配的讲稿。');
      used.add(id);
    }
  }
}
