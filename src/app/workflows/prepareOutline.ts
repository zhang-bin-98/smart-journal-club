import { z } from 'zod';
import {
  ContentSchema,
  SpeechSegmentSchema,
  OmissionSchema,
  type Content,
  contentOf,
  validateContent,
  uncoveredClaims,
  ContentError,
} from '../../modules/presentation/content';
import { SpeechPlanSchema } from '../../modules/presentation/planning';
import type { SpeechStore, SpeechWorkspace } from '../presentation/ports';
import type { ModelSettings } from '../settings/modelSettings';
import type { Preferences } from '../../modules/project/model';
import type { createModelRequests } from '../llm/requests';
import { ModelOutputError } from '../llm/modelError';
import { prompts, researchPrompt } from '../../shared/llm/prompts';
import { beginActivity } from '../activity';
import { speechBatches, combineSpeech } from '../presentation/speechBatches';
import { organizeSpeech } from './organizeSpeech';
import { speechContext } from '../presentation/speechContext';

export function assignSpeechIds(input: unknown, data: SpeechWorkspace) {
  const content = validateContent(input, data.paper);
  const missing = uncoveredClaims(content, data.paper).filter(
    (claim) => !content.omissions.some((o) => o.claimId === claim.id),
  );
  if (missing.length)
    throw new ContentError('uncovered-findings', '部分发现尚未形成讲述，原稿已保留，请重试。', {
      missingClaimIds: missing.map((c) => c.id),
    });
  if (!content.sections.length || !content.speechParagraphs.length || content.speech.some((s) => !s.text.trim()))
    throw new ContentError('empty-speech', '自动讲稿必须包含完整章节与非空正文。');
  const sectionIds = new Map(content.sections.map((s) => [s.id, crypto.randomUUID()]));
  const paragraphIds = new Map(content.speechParagraphs.map((s) => [s.id, crypto.randomUUID()]));
  const segmentIds = new Map(content.speech.map((s) => [s.id, crypto.randomUUID()]));
  const now = Date.now();
  return SpeechPlanSchema.parse({
    ...content,
    schemaVersion: 3,
    id: crypto.randomUUID(),
    paperId: data.paper.id,
    paperRevision: data.paper.revision,
    revision: 0,
    status: 'draft',
    slides: [],
    createdAt: now,
    updatedAt: now,
    sections: content.sections.map((s) => ({ ...s, id: sectionIds.get(s.id)! })),
    speechParagraphs: content.speechParagraphs.map((p) => ({
      ...p,
      id: paragraphIds.get(p.id)!,
      sectionId: sectionIds.get(p.sectionId)!,
      segmentIds: p.segmentIds.map((id) => segmentIds.get(id)!),
    })),
    speech: content.speech.map((s) => ({
      ...s,
      id: segmentIds.get(s.id)!,
      paragraphId: paragraphIds.get(s.paragraphId)!,
    })),
  });
}
/** 完整讲述保存后停止；取消、修复失败或基准变化均保留旧计划。 */
export async function prepareOutline(input: {
  projectId: string;
  store: SpeechStore;
  requests: ReturnType<typeof createModelRequests>;
  settings: ModelSettings;
  preferences?: Preferences;
  signal: AbortSignal;
  assertActive: () => void;
  image?: (data: SpeechWorkspace, signal: AbortSignal) => Promise<string | undefined>;
  onStage?: (stage: string) => void;
  refreshEvidence?: (id: string, settings: ModelSettings, signal: AbortSignal) => Promise<void>;
}) {
  const done = beginActivity();
  try {
    let opened = await input.store.open(input.projectId);
    if ((opened.workingPaper ?? opened.paper).pendingEvidenceFigureIds.length && input.refreshEvidence) {
      input.onStage?.('正在更新图源修改涉及的证据关联');
      await input.refreshEvidence(input.projectId, input.settings, input.signal);
      opened = await input.store.open(input.projectId);
    }
    const data = { ...opened, paper: opened.workingPaper ?? opened.paper };
    const expectedPlan = data.planKey;
    const paper = data.paper;
    if (paper.figureReview.confirmedRevision !== paper.figureReview.revision || paper.pendingEvidenceFigureIds.length)
      throw new ContentError('review-required', '请先确认图源切分并完成必要证据关联。');
    if (!paper.claims.length) throw new ContentError('no-findings', '论文尚无可生成讲述的发现，请先完成论文分析。');
    const preferences = structuredClone(input.preferences ?? data.project.preferences);
    const strategy = researchPrompt(preferences.strategyId).strategy;
    preferences.strategyId = strategy.id;
    input.signal.throwIfAborted();
    input.assertActive();
    input.onStage?.('正在准备原句、图注与图证据');

    const systemPrompt = [prompts.common, strategy.body, prompts.stages.speech].join('\n\n');
    const batches = speechBatches(paper);
    const parts: Content[] = [];
    const background = batches
      .filter((batch) => !batch.claims.length)
      .map((batch) => speechContext(batch, paper).context);
    for (const [batchIndex, batch] of batches.entries()) {
      if (!batch.claims.length) continue;
      const image = await input.image?.({ ...data, paper: batch }, input.signal);
      const indexed = speechContext(batch, paper);
      const claimId = indexed.claimIds.length ? z.enum(indexed.claimIds) : z.never();
      const sourceId = indexed.sourceIds.length ? z.enum(indexed.sourceIds) : z.never();
      const outputSchema = ContentSchema.extend({
        speech: z.array(SpeechSegmentSchema.extend({ claimIds: z.array(claimId), sourceIds: z.array(sourceId) })),
        omissions: z.array(OmissionSchema.extend({ claimId })),
      });
      const context = {
        preferences,
        paper: indexed.context,
        sequence: {
          part: batchIndex + 1,
          total: batches.length,
          precedingSections: parts.flatMap((part) =>
            part.sections.map((section) => ({ title: section.title, kind: section.kind, track: section.track })),
          ),
          instruction:
            '这是同一完整演讲稿的一组发现。仅覆盖本批 claims（每项都须形成正文）。全局 story 只作叙事参考，其引用不属于本批时不要借用。首批承担开场，末批承担总讨论和结论；中间批直接接续发现、方法与必要补充，不重复开场和全篇总结。输出中不提分批或内部处理。若本组只有全文补充材料而无 claims，只为有科学意义的新内容补充讲述；参考文献列表等可返回空 sections/speechParagraphs/speech，不能编造发现。',
        },
      };
      let failedOutput: unknown;
      let diagnostics: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        input.onStage?.(
          (attempt ? '正在修复本组讲述（仅一次）' : '正在整理完整讲述') +
            ' · ' +
            (batchIndex + 1) +
            '/' +
            batches.length,
        );
        try {
          const raw = await input.requests.requestJson({
            settings: input.settings,
            schema: outputSchema,
            signal: input.signal,
            stage: attempt ? 'speech-repair' : 'speech',
            systemPrompt:
              systemPrompt + (attempt ? '\n唯一一次定向修复：按 diagnostics 修复结构、引用及遗漏，保留无关内容。' : ''),
            data: attempt ? { ...context, failedOutput, diagnostics } : context,
            image,
            maxTokens: 24576,
          });
          failedOutput = raw;
          const decoded = indexed.decode(raw);
          const plan =
            !batch.claims.length && !decoded.speech.length
              ? validateContent(decoded, batch)
              : assignSpeechIds(decoded, { ...data, paper: batch });
          if (
            plan.omissions.length &&
            !/(压缩|精简|省略|只讲|仅讲|不讲|omit|compress|only discuss)/i.test(preferences.instruction)
          )
            throw new ContentError('automatic-omission', '默认生成不得省略论文发现。');
          validateContent(contentOf(plan), batch);
          input.signal.throwIfAborted();
          input.assertActive();
          parts.push(contentOf(plan));
          break;
        } catch (cause) {
          input.signal.throwIfAborted();
          if (
            attempt ||
            !(
              cause instanceof ModelOutputError ||
              (cause instanceof ContentError &&
                [
                  'uncovered-findings',
                  'empty-speech',
                  'invalid-content',
                  'missing-reference',
                  'missing-section',
                  'missing-segment',
                  'orphan-segment',
                  'duplicate-id',
                  'automatic-omission',
                ].includes(cause.code))
            )
          )
            throw cause;
          if (cause instanceof ModelOutputError) {
            failedOutput = cause.failedOutput;
            diagnostics = cause.diagnostics;
          } else
            diagnostics = indexed.encodeDiagnostics({
              code: cause.code,
              message: cause.message,
              details: cause.diagnostics,
            });
        }
      }
    }
    let combined = combineSpeech(parts);
    if (batches.length > 1)
      combined = await organizeSpeech({
        content: combined,
        paper,
        background,
        settings: input.settings,
        requests: input.requests,
        signal: input.signal,
        assertActive: input.assertActive,
        onStage: input.onStage,
      });
    const plan = assignSpeechIds(combined, data);
    input.onStage?.('正在保存完整讲稿');
    return await input.store.saveGenerated({
      record: {
        recordVersion: 2,
        projectId: input.projectId,
        stage: 'outline-ready',
        plan,
        generationPreferences: preferences,
        mode: data.project.currentDeckId ? 'regeneration' : 'initial',
        base: data.base,
      },
      expectedPlan,
      signal: input.signal,
      assertActive: input.assertActive,
    });
  } finally {
    done();
  }
}
