import type { Context, Model } from '@earendil-works/pi-ai';
import type { ModelAdapter, ModelRequest } from '../../app/llm/ports';
import { ModelError } from '../../app/llm/modelError';
import type { normalizeSettings, ModelSettings } from '../../app/settings/modelSettings';
import { type RequestScheduler, retryAfterMs, TemporaryRateLimit } from './requestScheduler';
import { estimateContextTokens } from '../../shared/modelCapacity';
import { responseTimeout } from './responseTimeout';

function describeModel(settings: ModelSettings, defaultContextWindow: number): Model<'openai-responses'> {
  return {
    id: settings.modelId,
    name: settings.modelId,
    baseUrl: settings.baseUrl,
    api: 'openai-responses',
    provider: 'responses',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: settings.contextWindow ?? defaultContextWindow,
    maxTokens: settings.maxOutputTokens ?? 24576,
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
  return body;
}

function failure(stage: string, status?: number, code?: string) {
  if (status === 401 || status === 403)
    return new ModelError(stage, 'authentication', '模型认证失败，请检查 API Key 后重试。');
  if (status === 402 || code === 'insufficient_quota' || code === 'quota_exceeded')
    return new ModelError(stage, 'quota', '模型额度不足，请检查供应商账户后重试。');
  if (status === 413)
    return new ModelError(
      stage,
      'request-size',
      '服务拒绝了当前请求大小。请核对该服务的请求体或图片限制；已保存成果仍保留。',
    );
  if (status === 429) return new ModelError(stage, 'rate-limit', '模型请求受到限流或额度限制，请检查服务额度后重试。');
  if (status === 400 || status === 404 || status === 422)
    return new ModelError(
      stage,
      'unsupported-config',
      '服务不接受当前模型或请求参数。请核对 Responses 地址、模型、Token 上限及所需能力，或将思考强度改回服务默认后重新检查。',
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

export function createResponsesAdapter(
  scheduler: RequestScheduler,
  normalize: typeof normalizeSettings,
  defaultContextWindow: number,
): ModelAdapter {
  const describe = (settings: ModelSettings) => describeModel(settings, defaultContextWindow);
  return {
    describe,
    async request(input) {
      const settings = normalize(input.settings);
      const maxTokens = Math.min(
        input.maxTokens ?? settings.maxOutputTokens ?? 16384,
        settings.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
      );
      const request = { ...input, settings, maxTokens };
      const { signal, stage } = request;
      if (!settings.apiKey) throw new ModelError(stage, 'missing-key', '请先在模型配置中填写 API Key。');
      if (typeof navigator !== 'undefined' && navigator.onLine === false)
        throw new ModelError(stage, 'offline', '当前离线，联网后可使用 AI；本地查看和编辑仍可用。');
      const tokens = estimateContextTokens(request.context, request.responseSchema) + maxTokens;
      if (tokens > (settings.contextWindow ?? defaultContextWindow))
        throw new ModelError(
          stage,
          'context-budget',
          '本次输入与预留输出估算超过上下文窗口。请核对模型配置中的上下文窗口或降低最大输出 Token 后重试。',
        );
      scheduler.configure(settings.concurrency);
      try {
        return await scheduler.run({
          signal,
          stage,
          priority: ['ai', 'connection', 'capabilities'].includes(stage) ? 'interactive' : 'background',
          execute: async () => {
            const timeout = responseTimeout(settings);
            const requestSignal = AbortSignal.any([signal, timeout.signal]);
            try {
              return await abortable(requestSignal, async () => {
                let responseStatus: number | undefined;
                let providerCode: string | undefined;
                let retryDelay: number | undefined;
                let payloadError: ModelError | undefined;
                let emitted = false;
                const { converted, logical } = wireTools(request.context);
                const { stream } = await import('@earendil-works/pi-ai/api/openai-responses');
                requestSignal.throwIfAborted();
                const events = stream(describe(settings), converted, {
                  apiKey: settings.apiKey,
                  signal: requestSignal,
                  maxTokens,
                  maxRetries: 0,
                  // 首响应/停滞/总时长由上面的应用计时器统一控制。
                  timeoutMs: 2147483647,
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
                    return timeout.watch(response);
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
                  if (event.type !== 'start') timeout.activity();
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
                  throw new ModelError(
                    stage,
                    'truncated',
                    '模型输出达到上限仍未完成。请在模型配置中核对最大输出 Token 后重试，已保存成果仍保留。',
                  );
                return {
                  ...result,
                  content: result.content.map((block) =>
                    block.type === 'toolCall' ? { ...block, name: logical.get(block.name) ?? block.name } : block,
                  ),
                };
              });
            } catch (cause) {
              signal.throwIfAborted();
              if (timeout.signal.aborted)
                throw new ModelError(stage, 'timeout', '模型响应超时，已停止本次请求。完整阶段仍保留，请稍后重试。');
              throw cause;
            } finally {
              timeout.dispose();
            }
          },
        });
      } catch (cause) {
        signal.throwIfAborted();
        if (cause instanceof ModelError) throw cause;
        throw failure(stage);
      }
    },
  };
}
