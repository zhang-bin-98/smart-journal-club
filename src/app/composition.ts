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
