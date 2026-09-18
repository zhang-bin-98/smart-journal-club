import { prompts } from '../src/infrastructure/llm/prompts';
import { slidesStore } from '../src/app/composition';
import { speechStore } from '../src/app/composition';
import { generatePresentation } from '../src/app/workflows/generatePresentation';
import { buildPresentation } from '../src/modules/presentation/build';
import { SpeechPlanSchema } from '../src/modules/presentation/planning';
import { contentOf } from '../src/modules/presentation/content';
import { ensureWorkingPaper } from '../src/infrastructure/persistence/paperStore';
import { saveRequirements } from '../src/infrastructure/persistence/projectStore';
import { get, transaction } from '../src/infrastructure/persistence/indexedDb';
import type { createModelRequests } from '../src/app/llm/requests';
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const rejects = async (work: () => Promise<unknown>) => {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, 'Expected rejection');
};
export async function verifySlidesStorage(projectId: string) {
  let calls = 0;
  const requests = {
    requestJson: async (input: { data: { speech: unknown[]; figures: unknown[]; section: { title: string } } }) => {
      calls++;
      return {
        slides: [
          {
            title: input.data.section.title,
            purpose: '固定响应',
            message: '',
            kind: 'result',
            speechIndexes: input.data.speech.map((_, i) => i),
            sourceIndexes: input.data.figures.length ? [0] : [],
          },
        ],
      };
    },
  } as unknown as ReturnType<typeof createModelRequests>;
  const settings = {
    protocol: 'responses' as const,
    baseUrl: 'https://example.com',
    modelId: 'fixed',
    apiKey: 'fixed',
    reasoningEffort: null,
  };
  const signal = new AbortController().signal;
  async function outline(strategyId = 'omics') {
    const data = await speechStore.open(projectId);
    const current = (await slidesStore.open(projectId)).current!;
    const paper = data.workingPaper ?? data.paper;
    const now = Date.now();
    await speechStore.saveGenerated({
      record: {
        recordVersion: 2,
        projectId,
        stage: 'outline-ready',
        mode: 'regeneration',
        base: data.base,
        generationPreferences: { ...data.project.preferences, strategyId },
        plan: SpeechPlanSchema.parse({
          ...contentOf({
            ...current,
            sections: current.sections.map((s) => ({ ...s, track: s.track ?? 'main' })),
            speech: current.speech ?? [],
            speechParagraphs: current.speechParagraphs ?? [],
            omissions: current.omissions ?? [],
          }),
          schemaVersion: 3,
          id: crypto.randomUUID(),
          paperId: paper.id,
          paperRevision: paper.revision,
          revision: 0,
          status: 'draft',
          slides: [],
          createdAt: now,
          updatedAt: now,
        }),
      },
      expectedPlan: data.planKey,
      signal,
      assertActive() {},
    });
  }
  await outline();
  let state = await generatePresentation({
    prompts,
    projectId,
    store: slidesStore,
    requests,
    settings,
    signal,
    assertActive() {},
  });
  const first = state.candidate!.id;
  const paperId = state.candidate!.paperId;
  assert(state.project.preferences.strategyId !== 'omics', 'Candidate changed project preferences before apply');
  const count = calls;
  state = await slidesStore.open(projectId);
  assert(calls === count && state.candidate!.id === first, 'Reopen reran model or lost candidate');
  const originalCurrent = state.current!.id;
  await outline('mechanism');
  // A second generation fails after planning, before any candidate write.
  await rejects(() =>
    generatePresentation({
      prompts,
      projectId,
      requests,
      settings,
      signal,
      assertActive() {},
      store: {
        ...slidesStore,
        saveBuild: async () => {
          throw new Error('injected storage failure');
        },
      },
    }),
  );
  state = await slidesStore.open(projectId);
  assert(
    state.candidate!.id === first && state.current!.id === originalCurrent,
    'Failed generation erased previous candidate',
  );
  const ready = state.record!;
  const candidateDeck = buildPresentation(ready.plan, state.workingPaper, crypto.randomUUID(), Date.now());
  let activeChecks = 0;
  await rejects(() =>
    slidesStore.saveBuild({
      projectId,
      deck: candidateDeck,
      expectedPlan: state.planKey,
      expectedCandidate: state.candidateKey,
      signal,
      assertActive() {
        if (++activeChecks === 2) throw new Error('cancel before write');
      },
    }),
  );
  assert((await slidesStore.open(projectId)).candidate!.id === first, 'Rollback did not retain candidate');
  state = await generatePresentation({
    prompts,
    projectId,
    store: slidesStore,
    requests,
    settings,
    signal,
    assertActive() {},
  });
  const second = state.candidate!.id;
  assert(second !== first, 'New successful candidate did not replace slot');
  assert(
    (await transaction(['decks'], 'readonly', (tx) => get(tx, 'decks', first))) === undefined,
    'Old candidate not reclaimed',
  );
  const applyKey = state.candidateKey;
  await rejects(() =>
    slidesStore.candidate({ projectId, expectedCandidate: 'old', action: 'apply', assertActive() {} }),
  );
  state = await slidesStore.candidate({ projectId, expectedCandidate: applyKey, action: 'apply', assertActive() {} });
  assert(
    state.current!.id === second && state.previous!.id === originalCurrent && !state.candidate,
    'Atomic candidate switch failed',
  );
  assert(
    state.project.preferences.strategyId === 'mechanism',
    'Successful apply did not commit actual generation preferences',
  );
  await outline();
  state = await generatePresentation({
    prompts,
    projectId,
    store: slidesStore,
    requests,
    settings,
    signal,
    assertActive() {},
  });
  const staleId = state.candidate!.id;
  const beforeRestore = state;
  let restoreChecks = 0;
  const restore = () =>
    slidesStore.restore({
      projectId,
      currentId: state.current!.id,
      previousId: state.previous!.id,
      currentRevision: state.current!.revision,
      previousRevision: state.previous!.revision,
      assertActive() {},
    });
  await rejects(() =>
    slidesStore.restore({
      projectId,
      currentId: state.current!.id,
      previousId: state.previous!.id,
      currentRevision: state.current!.revision,
      previousRevision: state.previous!.revision,
      assertActive() {
        if (++restoreChecks === 2) throw new Error('cancel restore before write');
      },
    }),
  );
  assert(
    (await slidesStore.open(projectId)).current!.revision === state.current!.revision,
    'Failed restore advanced revision',
  );
  state = await restore();
  assert(state.current!.revision === beforeRestore.previous!.revision + 1, 'Restore reused an old revision');
  state = await restore();
  assert(state.current!.id === beforeRestore.current!.id, 'Second restore did not return to original deck');
  assert(state.current!.revision === beforeRestore.current!.revision + 1, 'Second restore reused original revision');
  assert(!!state.candidateStale, 'Restoring twice revived the old candidate');
  await rejects(() =>
    slidesStore.candidate({ projectId, expectedCandidate: state.candidateKey, action: 'apply', assertActive() {} }),
  );
  await saveRequirements(projectId, { ...state.project.preferences, instruction: 'changed while candidate waiting' });
  state = await slidesStore.open(projectId);
  assert(!!state.candidateStale, 'Changed project preference did not stale candidate');
  await rejects(() =>
    slidesStore.candidate({ projectId, expectedCandidate: state.candidateKey, action: 'apply', assertActive() {} }),
  );
  await ensureWorkingPaper(projectId);
  state = await slidesStore.open(projectId);
  assert(
    state.workingPaper.id !== paperId && state.candidatePaper!.id === paperId,
    'Source edit did not preserve frozen candidate paper',
  );
  await slidesStore.candidate({
    projectId,
    expectedCandidate: state.candidateKey,
    action: 'discard',
    assertActive() {},
  });
  assert(
    (await transaction(['decks'], 'readonly', (tx) => get(tx, 'decks', staleId))) === undefined,
    'Discard left unreferenced candidate',
  );
  assert(!!(await slidesStore.open(projectId)).current, 'Discard erased current');
  await outline();
  state = await generatePresentation({
    prompts,
    projectId,
    store: slidesStore,
    requests,
    settings,
    signal,
    assertActive() {},
  });
  return {
    candidateForUi: state.candidate!.id,
    currentForUi: state.current!.id,
    calls,
    atomicSwitch: true,
    reopenWithoutBuild: true,
    failedGenerationRetainsCandidate: true,
    staleReadOnly: true,
    paperFrozen: true,
    reclamation: true,
  };
}
