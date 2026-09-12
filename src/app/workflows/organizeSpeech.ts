import type { PromptCatalog } from '../llm/promptCatalog';
import { z } from 'zod';
import {
  applyContentCommands,
  paragraphText,
  paragraphSources,
  validateContent,
  ContentError,
  SectionSchema,
  type Content,
} from '../../modules/presentation/content';
import type { Paper } from '../../modules/paper/model';
import type { ModelSettings } from '../settings/modelSettings';
import type { createModelRequests } from '../llm/requests';
import { ModelOutputError } from '../llm/modelError';

const StructureSchema = z.strictObject({
  sections: z.array(SectionSchema.extend({ sourceSectionIds: z.array(z.string()).min(1) })).min(1),
  corrections: z.array(z.strictObject({ paragraphId: z.string(), text: z.string().min(1) })),
});

/** 全稿统一组织只重排段落归属；术语修订限于附有原句的目标，不改变科学引用。 */
export async function organizeSpeech(input: {
  content: Content;
  paper: Paper;
  background?: unknown[];
  settings: ModelSettings;
  requests: ReturnType<typeof createModelRequests>;
  prompts: PromptCatalog;
  signal: AbortSignal;
  assertActive: () => void;
  onStage?: (stage: string) => void;
}): Promise<Content> {
  const aliases = new Map(input.content.speechParagraphs.map((p, index) => [`p${index + 1}`, p.id]));
  const paragraphs = [...aliases].map(([id, originalId]) => {
    const p = input.content.speechParagraphs.find((p) => p.id === originalId)!;
    const text = paragraphText(input.content, originalId);
    const sources = paragraphSources(input.content, originalId);
    const wordingSources = /过表达|[μµ]m|本批|批次/.test(text)
      ? input.paper.sources
          .filter((s) => sources.includes(s.id))
          .flatMap((source) => {
            const block = input.paper.blocks.find((b) => b.id === source.textSpan?.blockId);
            const quote =
              source.textQuote ??
              (block && source.textSpan ? block.text.slice(source.textSpan.start, source.textSpan.end) : undefined);
            return quote ? [quote] : [];
          })
      : [];
    return {
      id,
      purpose: p.purpose,
      text,
      currentSection: input.content.sections.find((s) => s.id === p.sectionId)?.title,
      ...(wordingSources.length ? { wordingSources } : {}),
    };
  });
  const sectionAliases = new Map(input.content.sections.map((section, index) => [`g${index + 1}`, section.id]));
  const groups = [...sectionAliases].map(([id, originalId]) => ({
    id,
    title: input.content.sections.find((section) => section.id === originalId)!.title,
    purposes: input.content.speechParagraphs
      .filter((paragraph) => paragraph.sectionId === originalId)
      .map((paragraph) => paragraph.purpose),
  }));
  let failedOutput: unknown;
  let diagnostics: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    input.signal.throwIfAborted();
    input.assertActive();
    input.onStage?.(attempt ? '正在修复大纲分配（仅一次）' : '正在统一大纲与主线、补充');
    try {
      const raw = await input.requests.requestJson({
        settings: input.settings,
        signal: input.signal,
        stage: attempt ? 'speech-structure-repair' : 'speech-structure',
        schema: StructureSchema,
        maxTokens: 49152,
        systemPrompt: `${input.prompts.common}\n\n${input.prompts.stages['speech-structure']}`,
        data: {
          title: input.content.title,
          language: input.content.language,
          groups,
          wording: paragraphs.filter((paragraph) => paragraph.wordingSources?.length),
          background: input.background,
          ...(attempt ? { failedOutput, diagnostics } : {}),
        },
      });
      failedOutput = raw;
      const used = raw.sections.flatMap((section) => section.sourceSectionIds);
      const missing = [...sectionAliases.keys()].filter((id) => !used.includes(id));
      const invalid = used.filter((id) => !sectionAliases.has(id));
      if (missing.length || invalid.length || new Set(used).size !== used.length)
        throw new ContentError('invalid-structure', '大纲段落分配不完整。', {
          missing,
          invalid,
          duplicate: used.filter((id, index) => used.indexOf(id) !== index),
        });
      if (
        new Set(raw.corrections.map((c) => c.paragraphId)).size !== raw.corrections.length ||
        raw.corrections.some((c) => !paragraphs.find((p) => p.id === c.paragraphId)?.wordingSources?.length)
      )
        throw new ContentError('invalid-structure', '术语修订超出原句支持范围。');
      const content = applyContentCommands(
        input.content,
        raw.corrections.map((c) => ({
          type: 'update-paragraph' as const,
          paragraphId: aliases.get(c.paragraphId)!,
          text: c.text,
        })),
        input.paper,
      );
      content.sections = raw.sections.map(({ sourceSectionIds: _assigned, ...section }) => section);
      content.speechParagraphs = raw.sections.flatMap((section) =>
        section.sourceSectionIds.flatMap((id) =>
          content.speechParagraphs
            .filter((paragraph) => paragraph.sectionId === sectionAliases.get(id))
            .map((paragraph) => ({
              ...paragraph,
              sectionId: section.id,
            })),
        ),
      );
      input.signal.throwIfAborted();
      input.assertActive();
      return validateContent(content, input.paper);
    } catch (cause) {
      input.signal.throwIfAborted();
      if (attempt || !(cause instanceof ModelOutputError || cause instanceof ContentError)) throw cause;
      if (cause instanceof ModelOutputError) {
        failedOutput = cause.failedOutput;
        diagnostics = cause.diagnostics;
      } else diagnostics = { code: cause.code, message: cause.message, details: cause.diagnostics };
    }
  }
  throw new ContentError('generation-failed', '大纲整理未完成，原稿已保留。');
}
