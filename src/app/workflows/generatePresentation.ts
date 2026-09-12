import type { PromptCatalog } from '../llm/promptCatalog';
import { buildPresentation } from '../../modules/presentation/build';
import { ContentError } from '../../modules/presentation/content';
import type { SlidesStore, SlidesGuard } from '../presentation/slidesPorts';
import type { ModelSettings } from '../settings/modelSettings';
import type { createModelRequests } from '../llm/requests';
import { assertGenerationBase } from '../presentation/planRecord';
import { beginActivity } from '../activity';
import { planSlides } from './planSlides';
/** Explicit entry authorization is owned by the caller; a saved ready plan resumes without another model call. */
export async function generatePresentation(
  input: SlidesGuard & {
    projectId: string;
    store: SlidesStore;
    requests: ReturnType<typeof createModelRequests>;
    prompts: PromptCatalog;
    settings: ModelSettings;
    onStage?: (stage: string) => void;
  },
) {
  const done = beginActivity();
  try {
    let state = await input.store.open(input.projectId);
    const capturedCandidate = state.candidateKey;
    let record = state.record;
    if (!record) throw new ContentError('missing-plan', '请先在大纲步骤准备完整讲稿。');
    assertGenerationBase(record.base, state.project, state.workingPaper, state.current, state.previous);
    input.assertActive();
    if (record.stage === 'outline-ready') {
      record = await planSlides({ ...input, record, paper: state.workingPaper });
      state = await input.store.savePlan({
        record,
        expectedPlan: state.planKey,
        signal: input.signal,
        assertActive: input.assertActive,
      });
    }
    input.onStage?.('页面计划已保存，正在制作完整幻灯片');
    input.signal.throwIfAborted();
    input.assertActive();
    const deck = buildPresentation(record.plan, state.workingPaper, crypto.randomUUID(), Date.now());
    return await input.store.saveBuild({
      projectId: input.projectId,
      expectedPlan: state.planKey,
      expectedCandidate: capturedCandidate,
      deck,
      signal: input.signal,
      assertActive: input.assertActive,
    });
  } finally {
    done();
  }
}
