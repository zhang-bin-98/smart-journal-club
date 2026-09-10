import { createAssistantStream } from '../../../app/llm/assistantStream';
import { describeModel, requestModel, type ModelSettings } from '../../../app/model';
export const assistantStream = (settings: ModelSettings) =>
  createAssistantStream(settings, requestModel, describeModel);
