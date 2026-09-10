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
