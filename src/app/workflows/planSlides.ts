import type { PromptCatalog } from '../llm/promptCatalog';
import { z } from 'zod';
import { paginateSpeech } from '../../modules/presentation/planning/paginateSpeech';
import { ModelOutputError } from '../llm/modelError';
import { computeLayout } from '../../modules/presentation/layout/computeLayout';
import { buildPresentation } from '../../modules/presentation/build';
import { ContentError, contentOf, SlideKinds } from '../../modules/presentation/content';
import { SpeechPlanSchema, type PlannedSlide } from '../../modules/presentation/planning';
import { rankGroups } from '../../modules/presentation/layout';
import { imageAspect, figureArea } from '../../modules/presentation/layout/figureGeometry';
import type { SlidesGuard } from '../presentation/slidesPorts';
import type { PlanRecord } from '../presentation/planRecord';
import type { Paper } from '../../modules/paper/model';
import type { ModelSettings } from '../settings/modelSettings';
import type { createModelRequests } from '../llm/requests';
const Output = z.strictObject({
  slides: z
    .array(
      z.strictObject({
        title: z.string(),
        purpose: z.string(),
        message: z.string(),
        kind: z.enum(SlideKinds),
        speechIndexes: z.array(z.number().int().nonnegative()).min(1),
        sourceIndexes: z.array(z.number().int().nonnegative()).max(4),
      }),
    )
    .min(1),
});
/** Plan all saved speech before returning a complete, validated ready plan. No persistence or React lifecycle. */
export async function planSlides(
  input: SlidesGuard & {
    record: PlanRecord;
    paper: Paper;
    settings: ModelSettings;
    requests: ReturnType<typeof createModelRequests>;
    prompts: PromptCatalog;
    onStage?: (stage: string) => void;
  },
): Promise<PlanRecord> {
  let record = input.record;
  const paper = input.paper;
  record = { ...record, plan: paginateSpeech(record.plan) };
  const slides: PlannedSlide[] = [];
  const content = contentOf(record.plan);
  const figures = paper.figures.flatMap((figure) =>
    figure.regions.flatMap((region) => [
      {
        figureId: figure.id,
        regionId: region.id,
        sourceId: region.sourceId,
        label: figure.label ?? '',
        panelId: undefined as string | undefined,
      },
      ...region.panels.map((panel) => ({
        figureId: figure.id,
        regionId: region.id,
        panelId: panel.id,
        sourceId: panel.sourceId,
        label: `${figure.label ?? ''} ${panel.label ?? ''}`,
      })),
    ]),
  );
  for (const [sectionIndex, section] of content.sections.entries()) {
    const paragraphs = content.speechParagraphs.filter((p) => p.sectionId === section.id);
    const ids = paragraphs.flatMap((p) => p.segmentIds);
    // Batch only at paragraph boundaries and retain all speech. Pages may combine paragraphs within the batch.
    const batches: string[][] = [];
    let batch: string[] = [];
    let size = 0;
    for (const paragraph of paragraphs) {
      const length = paragraph.segmentIds.reduce(
        (sum, id) => sum + content.speech.find((s) => s.id === id)!.text.length,
        0,
      );
      if (batch.length && size + length > 10000) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(...paragraph.segmentIds);
      size += length;
    }
    if (batch.length) batches.push(batch);
    if (!ids.length) continue;
    for (const batchIds of batches) {
      const speech = batchIds.map((id) => content.speech.find((s) => s.id === id)!);
      const sourceIds = new Set(speech.flatMap((s) => s.sourceIds));
      const available = figures.filter((f) => sourceIds.has(f.sourceId));
      let failure: unknown;
      let planned: PlannedSlide[] | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        input.onStage?.(
          `正在规划幻灯片 · ${sectionIndex + 1}/${content.sections.length}${attempt ? ' · 修复一次' : ''}`,
        );
        input.signal.throwIfAborted();
        input.assertActive();
        try {
          const response = await input.requests.requestJson({
            settings: input.settings,
            signal: input.signal,
            stage: 'slides',
            schema: Output,
            maxTokens: 16000,
            systemPrompt: `${input.prompts.common}\n\n${input.prompts.stages.slides}`,
            data: {
              preferences: record.generationPreferences,
              language: content.language,
              section,
              speech: speech.map((s, index) => ({ index, text: s.text, paragraphId: s.paragraphId })),
              figures: available.map((f, index) => ({
                index,
                label: f.label,
                source: paper.sources.find((s) => s.id === f.sourceId),
              })),
              ...(failure ? { diagnostics: String(failure) } : {}),
            },
          });
          const used = response.slides.flatMap((s) => s.speechIndexes);
          if (JSON.stringify(used) !== JSON.stringify(speech.map((_, i) => i)))
            throw new ContentError('speech-allocation', '每个讲稿片段须按原顺序恰好分配一次。');
          planned = response.slides.map((item) => {
            if (
              item.sourceIndexes.some((index) => !available[index]) ||
              new Set(item.sourceIndexes).size !== item.sourceIndexes.length
            )
              throw new ContentError('source-allocation', '页面图源编号无效。');
            const assigned = item.speechIndexes.map((index) => speech[index]);
            const id = crypto.randomUUID();
            const selected = item.sourceIndexes.map((index) => ({
              id: crypto.randomUUID(),
              figureId: available[index].figureId,
              regionId: available[index].regionId,
              panelId: available[index].panelId,
            }));
            const layoutId =
              selected.length > 2
                ? 'panel-grid'
                : selected.length === 2
                  ? 'two-figures'
                  : selected.length === 1
                    ? 'figure-full'
                    : item.kind === 'title'
                      ? 'title'
                      : 'text-only';
            const slide: PlannedSlide = {
              id,
              sectionId: section.id,
              kind: item.kind,
              title: item.title,
              purpose: item.purpose,
              message: item.message,
              layoutId,
              speechIds: assigned.map((s) => s.id),
              claimIds: [...new Set(assigned.flatMap((s) => s.claimIds))],
              sourceIds: [
                ...new Set([
                  ...assigned.flatMap((s) => s.sourceIds),
                  ...item.sourceIndexes.map((index) => available[index].sourceId),
                ]),
              ],
              figures: selected,
            };
            if (selected.length)
              slide.figureGroup = rankGroups(
                selected.map((figure) => ({
                  id: figure.id,
                  aspect: imageAspect(paper, { ...figure, type: 'figure' }),
                })),
                figureArea(slide),
              )[0]?.group;
            const geometry = computeLayout({
              ...slide,
              message: selected.length ? slide.message : '',
              elements: selected.length
                ? selected.map((figure) => ({ ...figure, type: 'figure' as const }))
                : slide.message
                  ? [{ id: `${id}-body`, type: 'text' as const, text: slide.message }]
                  : [],
            });
            if (
              geometry.titleText.overflow ||
              geometry.messageText.overflow ||
              geometry.elements.some((item) => item.text.overflow)
            )
              throw new ContentError('page-overflow', '屏幕文字放不下，请缩短标题/说明；完整内容保留在讲稿中。');
            return slide;
          });
          break;
        } catch (cause) {
          input.signal.throwIfAborted();
          if (attempt || !(cause instanceof ContentError || cause instanceof ModelOutputError)) throw cause;
          failure = cause;
        }
      }
      slides.push(...planned!);
    }
  }
  const plan = SpeechPlanSchema.parse({
    ...record.plan,
    slides,
    status: 'ready',
    revision: record.plan.revision + 1,
    updatedAt: Date.now(),
  });
  buildPresentation(plan, paper, 'validation', 0);
  record = { ...record, plan, stage: 'deck-plan-ready' };
  return record;
}
