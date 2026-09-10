import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelAdapter, ModelRequest } from '../llm/ports';
import { normalizeSettings, SettingsError, type ModelSettings } from './modelSettings';
import { ModelError } from '../llm/modelError';

export const capabilityLabels = {
  image: '图片输入',
  tools: '工具调用',
  structured: '结构化结果',
  stream: '流式返回',
} as const;
export type Capability = keyof typeof capabilityLabels;
export type CheckResult = { status: 'passed' | 'failed' | 'unchecked'; message: string };
export type CapabilityResults = Record<Capability, CheckResult>;
export const uncheckedResults = (): CapabilityResults =>
  Object.fromEntries(
    Object.keys(capabilityLabels).map((key) => [key, { status: 'unchecked', message: '未检查' }]),
  ) as CapabilityResults;
const textOf = (message: AssistantMessage) =>
  message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
export function createSettingsChecks(adapter: ModelAdapter, isBusy: () => boolean) {
  function requestFor(settings: ModelSettings, signal: AbortSignal, stage: string, prompt: string): ModelRequest {
    if (isBusy()) throw new SettingsError('busy', '任务正在运行，请等待任务完成或取消后再检查。');
    return {
      settings: normalizeSettings(settings),
      signal,
      stage,
      maxTokens: 2048,
      context: { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
    };
  }
  return {
    async connection(settings: ModelSettings, signal: AbortSignal) {
      const result = await adapter.request(requestFor(settings, signal, 'connection', 'Reply with exactly OK.'));
      signal.throwIfAborted();
      if (!textOf(result).trim())
        throw new ModelError('connection', 'empty-result', '服务未返回有效文本，请核对模型。');
    },
    async capabilities(
      settings: ModelSettings,
      signal: AbortSignal,
      image: string,
      onResult: (key: Capability, result: CheckResult) => void,
    ) {
      for (const key of Object.keys(capabilityLabels) as Capability[]) {
        signal.throwIfAborted();
        try {
          let request = requestFor(settings, signal, 'capabilities', 'Reply with exactly STREAM_OK.');
          let streamed = '';
          if (key === 'image')
            request.context.messages = [
              {
                role: 'user',
                timestamp: Date.now(),
                content: [
                  { type: 'text', text: 'Read the four digits shown in this image. Reply only with these digits.' },
                  { type: 'image', mimeType: 'image/png', data: image.slice(image.indexOf(',') + 1) },
                ],
              },
            ];
          if (key === 'tools') {
            request.context.tools = [
              {
                name: 'check_echo',
                description: 'Return the requested value.',
                parameters: {
                  type: 'object',
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  additionalProperties: false,
                },
              },
            ];
            request.context.messages = [
              { role: 'user', content: 'Call check_echo once with value TOOL_OK.', timestamp: Date.now() },
            ];
            request.outputTool = 'check_echo';
          }
          if (key === 'structured')
            request = {
              ...request,
              responseSchema: {
                type: 'object',
                properties: { connected: { type: 'boolean' } },
                required: ['connected'],
                additionalProperties: false,
              },
              context: {
                messages: [{ role: 'user', content: 'Return JSON with connected true.', timestamp: Date.now() }],
              },
            };
          if (key === 'stream')
            request.onText = (delta) => {
              streamed += delta;
            };
          const result = await adapter.request(request);
          signal.throwIfAborted();
          const text = textOf(result).trim();
          let passed = false;
          if (key === 'image') passed = text === '7392';
          if (key === 'tools')
            passed =
              result.content.filter((item) => item.type === 'toolCall').length === 1 &&
              result.content.some(
                (item) => item.type === 'toolCall' && item.name === 'check_echo' && item.arguments.value === 'TOOL_OK',
              );
          if (key === 'structured') {
            try {
              const value = JSON.parse(text);
              passed = value.connected === true && Object.keys(value).length === 1;
            } catch {
              passed = false;
            }
          }
          if (key === 'stream') passed = streamed.trim() === 'STREAM_OK' && text === 'STREAM_OK';
          onResult(key, {
            status: passed ? 'passed' : 'failed',
            message: passed ? '本次检查通过' : '返回内容未通过本项验证，请核对模型能力。',
          });
        } catch (cause) {
          signal.throwIfAborted();
          onResult(key, {
            status: 'failed',
            message:
              cause instanceof ModelError || cause instanceof SettingsError
                ? cause.message
                : '检查失败，请核对模型配置后重试。',
          });
        }
      }
    },
  };
}
