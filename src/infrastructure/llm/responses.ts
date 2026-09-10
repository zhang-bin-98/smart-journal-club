import type { Context, Model } from '@earendil-works/pi-ai';
import type { ModelAdapter, ModelRequest } from '../../app/llm/ports';
import { ModelError } from '../../app/llm/modelError';
import { normalizeSettings, type ModelSettings } from '../../app/settings/modelSettings';
import { type RequestScheduler, retryAfterMs, TemporaryRateLimit } from './requestScheduler';

export function describeModel(settings: ModelSettings): Model<'openai-responses'> {
  return {
    id: settings.modelId,
    name: settings.modelId,
    baseUrl: settings.baseUrl,
    api: 'openai-responses',
    provider: 'responses',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 24576,
    compat: { supportsDeveloperRole: false, supportsStrictMode: false },
  };
}

/** 在 Pi 序列化之后覆盖，默认省略、显式值原样发送，不经过 SDK 强度截断。 */
export function responsePayload(payload: unknown, request: ModelRequest): Record<string, unknown> {
  const body = { ...(payload as Record<string, unknown>) };
  delete body.reasoning;
  delete body.include;
  if (request.settings.reasoningEffort !== null) body.reasoning = { effort: request.settings.reasoningEffort };
  if (request.responseSchema)
    body.text = { format: { type: 'json_schema', name: 'result', strict: true, schema: request.responseSchema } };
  else if (request.json) body.text = { format: { type: 'json_object' } };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 8 * 1024 * 1024)
    throw new ModelError(request.stage, 'request-size', '本阶段内容超过请求预算，请减少输入内容后重试。');
  return body;
}

function failure(stage: string, status?: number, code?: string) {
  if (status === 401 || status === 403)
    return new ModelError(stage, 'authentication', '模型认证失败，请检查 API Key 后重试。');
  if (status === 402 || code === 'insufficient_quota' || code === 'quota_exceeded')
    return new ModelError(stage, 'quota', '模型额度不足，请检查供应商账户后重试。');
  if (status === 429) return new ModelError(stage, 'rate-limit', '模型请求受到限流或额度限制，请检查服务额度后重试。');
  if (status === 400 || status === 404 || status === 422)
    return new ModelError(
      stage,
      'unsupported-config',
      '服务不接受当前模型或请求参数。请核对 Responses 地址、模型及所需能力，或将思考强度改回服务默认后重新检查。',
    );
  return new ModelError(stage, 'model-request', '模型请求失败，请检查网络、服务地址及浏览器跨域访问支持后重试。');
}

/** 应用自己终止等待，迟到的 SDK 事件不能继续回填。 */
async function abortable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([run(), aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function wireTools(context: Context) {
  const names = new Map((context.tools ?? []).map((tool) => [tool.name, tool.name.replaceAll('.', '__')]));
  const logical = new Map([...names].map(([name, wire]) => [wire, name]));
  if (logical.size !== names.size) throw new ModelError('model', 'tool-name', '工具名称存在冲突，本次请求未执行。');
  const nameFor = (name: string) => names.get(name) ?? name;
  const converted: Context = {
    ...context,
    systemPrompt: [...names].reduce((prompt, [name, wire]) => prompt?.split(name).join(wire), context.systemPrompt),
    tools: context.tools?.map((tool) => ({ ...tool, name: nameFor(tool.name) })),
    messages: context.messages.map((message) => {
      if (message.role === 'toolResult') return { ...message, toolName: nameFor(message.toolName) };
      if (message.role !== 'assistant') return message;
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'toolCall' ? { ...block, name: nameFor(block.name) } : block,
        ),
      };
    }),
  };
  return { converted, logical, nameFor };
}

function estimateTokens(request: ModelRequest) {
  let images = 0;
  const text = JSON.stringify(request.context, (_key, value) => {
    if (value && typeof value === 'object' && value.type === 'image') {
      images++;
      return '[image]';
    }
    return value;
  });
  return Math.ceil(text.length / 2) + images * 4096 + (request.maxTokens ?? 16384);
}

export function createResponsesAdapter(scheduler: RequestScheduler): ModelAdapter {
  return {
    describe: describeModel,
    async request(input) {
      const settings = normalizeSettings(input.settings);
      const request = { ...input, settings };
      const { signal, stage } = request;
      if (!settings.apiKey) throw new ModelError(stage, 'missing-key', '请先在模型配置中填写 API Key。');
      if (typeof navigator !== 'undefined' && navigator.onLine === false)
        throw new ModelError(stage, 'offline', '当前离线，联网后可使用 AI；本地查看和编辑仍可用。');
      const timeout = AbortSignal.timeout(180000);
      const requestSignal = AbortSignal.any([signal, timeout]);
      try {
        return await scheduler.run({
          signal: requestSignal,
          tokens: estimateTokens(request),
          actualTokens: (result) => result.usage.totalTokens,
          stage,
          priority: ['ai', 'connection', 'capabilities'].includes(stage) ? 'interactive' : 'background',
          execute: () =>
            abortable(requestSignal, async () => {
              let responseStatus: number | undefined;
              let providerCode: string | undefined;
              let retryDelay: number | undefined;
              let payloadError: ModelError | undefined;
              let emitted = false;
              const { converted, logical } = wireTools(request.context);
              const { stream } = await import('@earendil-works/pi-ai/api/openai-responses');
              requestSignal.throwIfAborted();
              const events = stream(describeModel(settings), converted, {
                apiKey: settings.apiKey,
                signal: requestSignal,
                maxTokens: request.maxTokens ?? 16384,
                maxRetries: 0,
                timeoutMs: 180000,
                cacheRetention: 'none',
                ...(request.outputTool ? { toolChoice: 'auto' as const } : {}),
                fetch: async (url, init) => {
                  const response = await fetch(url, { ...init, redirect: 'error' });
                  responseStatus = response.status;
                  scheduler.observe(response.headers);
                  retryDelay = retryAfterMs(response.headers.get('retry-after'));
                  if (!response.ok) {
                    const raw = await response
                      .clone()
                      .json()
                      .catch(() => undefined);
                    providerCode = typeof raw?.error?.code === 'string' ? raw.error.code : raw?.error?.type;
                  }
                  return response;
                },
                onPayload: (payload) => {
                  try {
                    return responsePayload(payload, request);
                  } catch (cause) {
                    if (cause instanceof ModelError) payloadError = cause;
                    throw cause;
                  }
                },
              });
              for await (const event of events) {
                requestSignal.throwIfAborted();
                if (event.type === 'text_delta') {
                  emitted = true;
                  request.onText?.(event.delta);
                }
              }
              const result = await events.result();
              requestSignal.throwIfAborted();
              if (payloadError) throw payloadError;
              if (result.stopReason === 'error' || result.stopReason === 'aborted') {
                if (
                  !emitted &&
                  responseStatus === 429 &&
                  ['rate_limit_exceeded', 'too_many_requests'].includes(providerCode ?? '')
                )
                  throw new TemporaryRateLimit(stage, retryDelay);
                throw failure(stage, responseStatus, providerCode);
              }
              if (result.stopReason === 'length')
                throw new ModelError(stage, 'truncated', '模型输出未完成，当前阶段没有保存，请重试当前步骤。');
              return {
                ...result,
                content: result.content.map((block) =>
                  block.type === 'toolCall' ? { ...block, name: logical.get(block.name) ?? block.name } : block,
                ),
              };
            }),
        });
      } catch (cause) {
        signal.throwIfAborted();
        if (timeout.aborted)
          throw new ModelError(stage, 'timeout', '模型响应超时，已停止本次请求。完整阶段仍保留，请稍后重试。');
        if (cause instanceof ModelError) throw cause;
        throw failure(stage);
      }
    },
  };
}
