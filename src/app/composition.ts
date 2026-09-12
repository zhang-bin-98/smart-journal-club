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
import { settingsStore } from '../infrastructure/persistence/settingsStore';
import { createModelRequests, guardModelRequests } from './llm/requests';
import { createSettingsService } from './settings/settingsService';
import { createSettingsChecks } from './settings/settingsChecks';
import { hasRunningActivity, beginSettingsWrite } from './activity';
export const modelScheduler = new RequestScheduler();
const rawAdapter = createResponsesAdapter(modelScheduler);
const adapter = guardModelRequests(rawAdapter, () => settingsService.isWriting());
export const modelRequests = createModelRequests(adapter);
export const describeModel = adapter.describe;
export const settingsService = createSettingsService(
  settingsStore,
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
export const analysisService = createAnalysisService(analysisStore, createAnalysisResource, modelRequests);
export const projectsService = createProjectService({
  store: projectStore,
  validateFile: checkPdfFile,
  removeSession: analysisService.remove,
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

import { speechStore } from '../infrastructure/persistence/speechStore';
import { speechEvidence } from '../infrastructure/pdf/speechEvidence';
import { createSpeechEvidenceRefresh } from './presentation/refreshSpeechEvidence';
import { createOutlineSession } from './presentation/OutlineSession';
import { prepareOutline } from './workflows/prepareOutline';
import { createSpeechAssistant } from './assistant/speechAssistant';
export const createSpeechSession = (id: string, preferPlan: boolean | (() => boolean) = false) =>
  createOutlineSession(id, {
    ...speechStore,
    open: (projectId) => speechStore.open(projectId, typeof preferPlan === 'function' ? preferPlan() : preferPlan),
  });
export const createSpeechResources = async (id: string) => createFigureResources(await projectStore.openProject(id));
export const generateSpeech = (
  input: Omit<Parameters<typeof prepareOutline>[0], 'store' | 'requests' | 'image' | 'refreshEvidence'>,
) =>
  prepareOutline({
    ...input,
    store: speechStore,
    requests: modelRequests,
    image: speechEvidence,
    refreshEvidence: createSpeechEvidenceRefresh(analysisService),
  });
export const askSpeech = createSpeechAssistant(createReadOnlyAgent(adapter));

import { slidesStore } from '../infrastructure/persistence/slidesStore';
import { DeckSession } from './presentation/DeckSession';
import { generatePresentation } from './workflows/generatePresentation';
import { exportPresentation } from './presentation/exportPresentation';
import { exportWithResources } from '../infrastructure/pptx/presentationResource';
import { downloadDeck } from '../infrastructure/pptx/export';
import { createSlidesAssistant } from './assistant/slidesAssistant';
export const slidesService = {
  open: slidesStore.open,
  candidate: slidesStore.candidate,
  restore: slidesStore.restore,
  rememberSlide: slidesStore.rememberSlide,
  session: (state: Awaited<ReturnType<typeof slidesStore.open>>) =>
    state.current
      ? new DeckSession(state.current, state.paper, slidesStore.revision(state.project.id), state.project.id)
      : undefined,
  resources: (state: Awaited<ReturnType<typeof slidesStore.open>>) =>
    createFigureResources({ project: state.project, paper: state.paper, assets: state.assets }),
  generate: (input: Omit<Parameters<typeof generatePresentation>[0], 'store' | 'requests'>) =>
    generatePresentation({ ...input, store: slidesStore, requests: modelRequests }),
  export: (input: Omit<Parameters<typeof exportPresentation>[0], 'store' | 'export' | 'download'>) =>
    exportPresentation({ ...input, store: slidesStore, export: exportWithResources, download: downloadDeck }),
};
export const askSlides = createSlidesAssistant(createReadOnlyAgent(adapter));
