import { assertSettingsBase, DEFAULT_CONTEXT_WINDOW, normalizeSettings } from './settings/modelSettings';
import { prompts } from '../infrastructure/llm/prompts';
export const researchStrategies = prompts.strategies.map(({ id, name, description }) => ({ id, name, description }));
import { PlanRecordSchema, assertGenerationBase } from './presentation/planRecord';
import { supplementAddedRegion } from './paper/supplementAddedRegion';
import { createFigureSession } from './paper/figureSession';
import { createFigureResources } from '../infrastructure/pdf/figureResource';
import { recognizeFigure } from './paper/recognizeFigure';
import { createPaperAssistant } from './paper/paperAssistant';
import { createReadOnlyAgent } from '../infrastructure/llm/readOnlyAgent';
import * as projectStore from '../infrastructure/persistence/projectStore';
import * as paperStore from '../infrastructure/persistence/paperStore';
import { createAnalysisResource } from '../infrastructure/pdf/analysisResource';
import { checkPdfFile } from '../infrastructure/pdf/pdfResource';
import { createAnalysisService } from './paper/analysisService';
import { createProjectService } from './projects/service';
import type { AnalysisStore } from './paper/ports';
import { createResponsesAdapter } from '../infrastructure/llm/responses';
import { RequestScheduler } from '../infrastructure/llm/requestScheduler';
import { createSettingsStore } from '../infrastructure/persistence/settingsStore';
import { createModelRequests, guardModelRequests } from './llm/requests';
import { createSettingsService } from './settings/settingsService';
import { createSettingsChecks } from './settings/settingsChecks';
import { hasRunningActivity, beginSettingsWrite } from './activity';
export const modelScheduler = new RequestScheduler();
const rawAdapter = createResponsesAdapter(modelScheduler, normalizeSettings, DEFAULT_CONTEXT_WINDOW);
const adapter = guardModelRequests(rawAdapter, () => settingsService.isWriting());
export const modelRequests = createModelRequests(adapter);
export const describeModel = adapter.describe;
export const settingsService = createSettingsService(
  createSettingsStore(assertSettingsBase),
  () => hasRunningActivity() || modelScheduler.snapshot().running > 0 || modelScheduler.snapshot().queued > 0,
  beginSettingsWrite,
);
export const settingsChecks = createSettingsChecks(adapter, () => hasRunningActivity() || settingsService.isWriting());

const analysisStore: AnalysisStore = {
  openProject: projectStore.openProject,
  prepareWorkspace: paperStore.ensureWorkingPaper,
  commitUnit: paperStore.commitUnit,
  setPageSelection: paperStore.setPageSelection,
  saveRequirements: projectStore.saveInstruction,
  openStep: (id, step) => projectStore.openStep(id, step ?? 'paper-analysis'),
};
export const analysisService = createAnalysisService(analysisStore, createAnalysisResource, modelRequests, prompts);
export const projectsService = createProjectService({
  store: projectStore,
  validateFile: checkPdfFile,
  removeSession: async (id) => {
    presentationSessions.remove(id);
    await analysisService.remove(id);
  },
});
export const askPaper = createPaperAssistant(createReadOnlyAgent(adapter));
export const createReviewSession = (id: string) =>
  createFigureSession(
    id,
    {
      openProject: projectStore.openProject,
      saveFigure: paperStore.saveFigure,
      loadConsumers: paperStore.loadFigureConsumers,
    },
    () => analysisService.session(id).cancel(),
  );
export const createReviewResources = createFigureResources;
export const recognizeReviewFigure = (input: Omit<Parameters<typeof recognizeFigure>[0], 'requests'>) =>
  recognizeFigure({ ...input, requests: modelRequests });

export const supplementReviewRegion = (input: Omit<Parameters<typeof supplementAddedRegion>[0], 'requests'>) =>
  supplementAddedRegion({ ...input, requests: modelRequests });

import { createSpeechStore } from '../infrastructure/persistence/speechStore';
export const speechStore = createSpeechStore({ parsePlanRecord: PlanRecordSchema.parse, assertGenerationBase });
import { speechEvidence } from '../infrastructure/pdf/speechEvidence';
import { createSpeechEvidenceRefresh } from './presentation/refreshSpeechEvidence';
import { createOutlineSession } from './presentation/OutlineSession';
import { prepareOutline } from './workflows/prepareOutline';
import { createSpeechAssistant } from './assistant/speechAssistant';
export const createSpeechSession = (
  id: string,
  preferPlan: boolean | (() => boolean) = false,
  beforeEdit?: () => void,
) =>
  createOutlineSession(
    id,
    {
      ...speechStore,
      open: (projectId) => speechStore.open(projectId, typeof preferPlan === 'function' ? preferPlan() : preferPlan),
    },
    beforeEdit,
  );
export const createSpeechResources = async (id: string) => createFigureResources(await projectStore.openProject(id));
export const generateSpeech = (
  input: Omit<Parameters<typeof prepareOutline>[0], 'store' | 'requests' | 'image' | 'refreshEvidence' | 'prompts'>,
) =>
  prepareOutline({
    ...input,
    prompts,
    store: speechStore,
    requests: modelRequests,
    image: speechEvidence,
    refreshEvidence: createSpeechEvidenceRefresh(analysisService),
  });
export const askSpeech = createSpeechAssistant(createReadOnlyAgent(adapter));

import { createSlidesStore } from '../infrastructure/persistence/slidesStore';
export const slidesStore = createSlidesStore({ parsePlanRecord: PlanRecordSchema.parse, assertGenerationBase });
import { createSlidesService } from './presentation/service';
import { exportWithResources } from '../infrastructure/pptx/presentationResource';
import { downloadDeck } from '../infrastructure/pptx/export';
import { createSlidesAssistant } from './assistant/slidesAssistant';
export const slidesService = createSlidesService({
  store: slidesStore,
  requests: modelRequests,
  prompts,
  resources: createFigureResources,
  export: exportWithResources,
  download: downloadDeck,
});
export const askSlides = createSlidesAssistant(createReadOnlyAgent(adapter));

import { createPresentationSessions } from './presentation/projectSessions';
import { createSpeechController } from './presentation/speechController';
import { createSlidesController } from './presentation/slidesController';
export const presentationSessions = createPresentationSessions({
  speech: (id, guards) =>
    createSpeechController(id, {
      ...guards,
      session: (projectId, preferPlan) => createSpeechSession(projectId, preferPlan, guards.beforeEdit),
      resources: createSpeechResources,
      generate: generateSpeech,
      ask: askSpeech,
    }),
  slides: (id, guards) => createSlidesController(id, { ...guards, service: slidesService, ask: askSlides }),
});

import { clearAppStorage, holdStorageSession } from '../infrastructure/persistence/storageReset';
import { createStorageReset } from './settings/resetStorage';
export const storageReset = createStorageReset(
  clearAppStorage,
  () =>
    hasRunningActivity() ||
    settingsService.isWriting() ||
    modelScheduler.snapshot().running > 0 ||
    modelScheduler.snapshot().queued > 0,
);
export const initializeStorageSession = holdStorageSession;
