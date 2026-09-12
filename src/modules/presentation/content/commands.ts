import { z } from 'zod';
import { ContentError, SectionSchema, SpeechParagraphSchema, SpeechSegmentSchema, type Content } from './schema';
import { validateContent, recordUserOmissions } from './rules';
import type { Paper } from '../../paper/model';

const id = z.string().min(1);
export const ContentCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('update-section'),
    sectionId: id,
    patch: SectionSchema.omit({ id: true }).partial(),
  }),
  z.strictObject({ type: z.literal('add-section'), section: SectionSchema, afterId: id.nullable() }),
  z.strictObject({ type: z.literal('delete-section'), sectionId: id }),
  z.strictObject({ type: z.literal('move-section'), sectionId: id, afterId: id.nullable() }),
  z.strictObject({
    type: z.literal('add-paragraph'),
    paragraph: SpeechParagraphSchema,
    segments: z.array(SpeechSegmentSchema).min(1),
    afterId: id.nullable(),
  }),
  z.strictObject({ type: z.literal('delete-paragraph'), paragraphId: id }),
  z.strictObject({ type: z.literal('move-paragraph'), paragraphId: id, sectionId: id, afterId: id.nullable() }),
  z.strictObject({
    type: z.literal('update-paragraph'),
    paragraphId: id,
    purpose: z.string().optional(),
    text: z.string().optional(),
    sourceIds: z.array(id).optional(),
    claimIds: z.array(id).optional(),
  }),
  z.strictObject({
    type: z.literal('split-paragraph'),
    paragraphId: id,
    offset: z.number().int().positive(),
    newParagraphId: id,
    newSegmentId: id,
  }),
  z.strictObject({ type: z.literal('merge-paragraph'), paragraphId: id, nextParagraphId: id }),
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;
function move<T extends { id: string }>(items: T[], target: T, afterId: string | null) {
  if (afterId === target.id || (afterId !== null && !items.some((s) => s.id === afterId)))
    throw new ContentError('invalid-position', '目标位置已不存在。');
  const rest = items.filter((s) => s.id !== target.id);
  rest.splice(afterId === null ? 0 : rest.findIndex((s) => s.id === afterId) + 1, 0, target);
  return rest;
}
/** 整批在副本执行；验证失败不修改输入，重排不重建任何已有身份。 */
export function applyContentCommands(content: Content, commands: ContentCommand[], paper: Paper): Content {
  const next = structuredClone(content);
  const section = (id: string) => {
    const value = next.sections.find((s) => s.id === id);
    if (!value) throw new ContentError('missing-section', '章节不存在。');
    return value;
  };
  const paragraph = (id: string) => {
    const value = next.speechParagraphs.find((s) => s.id === id);
    if (!value) throw new ContentError('missing-paragraph', '讲述段落不存在。');
    return value;
  };
  const remove = (id: string) => {
    paragraph(id);
    next.speechParagraphs = next.speechParagraphs.filter((s) => s.id !== id);
    next.speech = next.speech.filter((s) => s.paragraphId !== id);
  };
  for (const raw of commands) {
    const command = ContentCommandSchema.parse(raw);
    switch (command.type) {
      case 'update-section':
        Object.assign(section(command.sectionId), command.patch);
        break;
      case 'add-section':
        if (next.sections.some((s) => s.id === command.section.id))
          throw new ContentError('duplicate-id', '章节身份重复。');
        next.sections = move(next.sections, command.section, command.afterId);
        break;
      case 'move-section':
        next.sections = move(next.sections, section(command.sectionId), command.afterId);
        break;
      case 'delete-section':
        section(command.sectionId);
        for (const p of next.speechParagraphs.filter((p) => p.sectionId === command.sectionId)) remove(p.id);
        next.sections = next.sections.filter((s) => s.id !== command.sectionId);
        break;
      case 'add-paragraph':
        if (next.speechParagraphs.some((p) => p.id === command.paragraph.id))
          throw new ContentError('duplicate-id', '段落身份重复。');
        section(command.paragraph.sectionId);
        if (command.afterId && paragraph(command.afterId).sectionId !== command.paragraph.sectionId)
          throw new ContentError('invalid-position', '插入位置不属于目标章节。');
        next.speechParagraphs = move(next.speechParagraphs, command.paragraph, command.afterId);
        next.speech.push(...command.segments);
        break;
      case 'delete-paragraph':
        remove(command.paragraphId);
        break;
      case 'move-paragraph': {
        section(command.sectionId);
        if (command.afterId && paragraph(command.afterId).sectionId !== command.sectionId)
          throw new ContentError('invalid-position', '插入位置不属于目标章节。');
        const p = paragraph(command.paragraphId);
        p.sectionId = command.sectionId;
        next.speechParagraphs = move(next.speechParagraphs, p, command.afterId);
        break;
      }
      case 'update-paragraph': {
        const p = paragraph(command.paragraphId);
        if (command.purpose !== undefined) p.purpose = command.purpose;
        const parts = p.segmentIds.map((id) => next.speech.find((s) => s.id === id)!);
        if (command.text !== undefined) {
          const original = parts.map((part) => part.text).join('');
          const replacement = command.text;
          let prefix = 0;
          while (prefix < original.length && prefix < replacement.length && original[prefix] === replacement[prefix])
            prefix++;
          let suffix = 0;
          while (
            suffix < original.length - prefix &&
            suffix < replacement.length - prefix &&
            original[original.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
          )
            suffix++;
          const end = original.length - suffix;
          const inserted = replacement.slice(prefix, replacement.length - suffix);
          let offset = 0;
          let applied = false;
          for (const part of parts) {
            const start = offset;
            offset += part.text.length;
            if (offset < prefix || start > end) continue;
            const head = part.text.slice(0, Math.max(0, prefix - start));
            const tail = part.text.slice(Math.max(0, end - start));
            part.text = head + (applied ? '' : inserted) + tail;
            applied = true;
          }
        }
        for (const part of parts) {
          if (command.sourceIds) part.sourceIds = [...new Set(command.sourceIds)];
          if (command.claimIds) part.claimIds = [...new Set(command.claimIds)];
        }
        break;
      }
      case 'split-paragraph': {
        const p = paragraph(command.paragraphId);
        const parts = p.segmentIds.map((id) => next.speech.find((s) => s.id === id)!);
        const text = parts.map((s) => s.text).join('');
        if (command.offset >= text.length || !/[。！？.!?\n]\s*$/.test(text.slice(0, command.offset)))
          throw new ContentError('invalid-split', '请在完整句子结束处拆分。');
        const beforeIds: string[] = [];
        const afterIds: string[] = [];
        const allSources = [...new Set(parts.flatMap((part) => part.sourceIds))];
        let offset = 0;
        for (const part of parts) {
          const end = offset + part.text.length;
          part.sourceIds = [...allSources];
          if (end <= command.offset) beforeIds.push(part.id);
          else if (offset >= command.offset) {
            part.paragraphId = command.newParagraphId;
            afterIds.push(part.id);
          } else {
            const cut = command.offset - offset;
            next.speech.push({
              ...structuredClone(part),
              id: command.newSegmentId,
              paragraphId: command.newParagraphId,
              text: part.text.slice(cut),
            });
            part.text = part.text.slice(0, cut);
            beforeIds.push(part.id);
            afterIds.push(command.newSegmentId);
          }
          offset = end;
        }
        p.segmentIds = beforeIds;
        next.speechParagraphs = move(
          next.speechParagraphs,
          { ...p, id: command.newParagraphId, segmentIds: afterIds },
          p.id,
        );
        break;
      }
      case 'merge-paragraph': {
        const p = paragraph(command.paragraphId);
        const other = paragraph(command.nextParagraphId);
        const peers = next.speechParagraphs.filter((s) => s.sectionId === p.sectionId);
        if (peers[peers.indexOf(p) + 1]?.id !== other.id)
          throw new ContentError('invalid-merge', '只能合并本章相邻讲述。');
        const sourceIds = [
          ...new Set(
            next.speech.filter((s) => s.paragraphId === p.id || s.paragraphId === other.id).flatMap((s) => s.sourceIds),
          ),
        ];
        for (const segment of next.speech.filter((s) => s.paragraphId === other.id || s.paragraphId === p.id)) {
          segment.paragraphId = p.id;
          segment.sourceIds = sourceIds;
        }
        const boundary = next.speech.find((segment) => segment.id === other.segmentIds[0])!;
        boundary.text = '\n' + boundary.text;
        p.segmentIds.push(...other.segmentIds);
        next.speechParagraphs = next.speechParagraphs.filter((s) => s.id !== other.id);
        break;
      }
    }
  }
  recordUserOmissions(content, next, paper);
  return validateContent(next, paper);
}
