import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import type { ModelSettings } from '../settings/modelSettings';

export type ModelRequest = {
  settings: ModelSettings;
  context: Context;
  signal: AbortSignal;
  stage: string;
  json?: boolean;
  maxTokens?: number;
  outputTool?: string;
  onText?: (delta: string) => void;
  responseSchema?: Record<string, unknown>;
};
export type ModelAdapter = {
  request: (request: ModelRequest) => Promise<AssistantMessage>;
  describe: (settings: ModelSettings) => Model<'openai-responses'>;
};
