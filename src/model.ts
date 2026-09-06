import type { Context, Model, Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';

export const MODEL_ID = 'deepseek-v4-flash-vision-exp';
export const ModelSettingsSchema = z.strictObject({ modelId: z.literal(MODEL_ID), apiKey: z.string() });
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;
export const DEFAULT_SETTINGS: ModelSettings = { modelId: MODEL_ID, apiKey: '' };
const model: Model<'openai-completions'> = {
  id: MODEL_ID, name: 'DeepSeek V4 Flash Vision', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com',
  reasoning: true, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 24576,
  compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false, supportsReasoningEffort: false, thinkingFormat: 'deepseek', maxTokensField: 'max_tokens' },
};
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export class ModelError extends Error {
  constructor(public readonly stage: string, public readonly code: string, message: string) { super(message); }
}
function failure(stage: string, status?: number) {
  if (status === 401 || status === 403) return new ModelError(stage, 'authentication', '模型认证失败，请检查 API Key 后重试。');
  if (status === 402) return new ModelError(stage, 'quota', '模型额度不足，请检查供应商账户后重试。');
  if (status === 429) return new ModelError(stage, 'rate-limit', '模型请求受到限流，请稍后重试当前步骤。');
  return new ModelError(stage, 'model-request', '模型请求失败，请检查网络及模型设置后重试当前步骤。');
}
export async function requestModel(settings: ModelSettings, context: Context, signal: AbortSignal, stage: string, json = false, maxTokens = 16384, outputTool?: string) {
  if (!settings.apiKey.trim()) throw new ModelError(stage, 'missing-key', '请先在模型设置中配置 API Key。');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ModelError(stage, 'offline', '当前离线，联网后可继续使用 AI；本地查看和编辑仍可用。');
  signal.throwIfAborted(); let status: number | undefined;
  // DeepSeek 函数名不支持点号；只转换本轮已声明工具，应用内仍使用逻辑名称。
  const toolNames = new Map((context.tools ?? []).map(tool => [tool.name, tool.name.replaceAll('.', '__')]));
  const logicalNames = new Map([...toolNames].map(([logical, wire]) => [wire, logical]));
  if (logicalNames.size !== toolNames.size) throw new ModelError(stage, 'tool-name', '工具名称存在冲突，本次请求未执行。');
  const wireName = (name: string) => toolNames.get(name) ?? name;
  const wireContext: Context = {
    ...context,
    systemPrompt: [...toolNames].reduce((prompt, [logical, wire]) => prompt?.split(logical).join(wire), context.systemPrompt),
    tools: context.tools?.map(tool => ({ ...tool, name: wireName(tool.name) })),
    messages: context.messages.map(message => message.role === 'toolResult' ? { ...message, toolName: wireName(message.toolName) } : message.role === 'assistant' ? { ...message, content: message.content.map(block => block.type === 'toolCall' ? { ...block, name: wireName(block.name) } : block) } : message),
  };
  const timeout = AbortSignal.timeout(180000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  try {
    const { stream } = await import('@earendil-works/pi-ai/api/openai-completions');
    const response = await stream(model, wireContext, {
      apiKey: settings.apiKey, signal: requestSignal, temperature: .2, maxTokens, maxRetries: 0, timeoutMs: 180000,
      ...(outputTool ? { toolChoice: { type: 'function' as const, function: { name: wireName(outputTool) } } } : {}),
      onResponse: response => { status = response.status; },
      onPayload: payload => {
        const body = { ...(payload as Record<string, unknown>), ...(json ? { response_format: { type: 'json_object' } } : {}) };
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_REQUEST_BYTES) throw new ModelError(stage, 'request-size', '本阶段内容超过请求预算，请减少输入内容后重试。');
        return body;
      },
    }).result();
    signal.throwIfAborted();
    if (timeout.aborted) throw new ModelError(stage, 'timeout', '模型响应超时，已停止本次请求。完整阶段仍保留，请稍后重试。');
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      const code = response.errorMessage?.match(/\b(401|402|403|429|5\d\d)\b/)?.[1];
      throw failure(stage, code ? Number(code) : status);
    }
    if (response.stopReason === 'length') throw new ModelError(stage, 'truncated', '模型输出未完成，当前阶段没有保存，请重试当前步骤。');
    return { ...response, content: response.content.map(block => block.type === 'toolCall' ? { ...block, name: logicalNames.get(block.name) ?? block.name } : block) };
  } catch (cause) {
    signal.throwIfAborted();
    if (timeout.aborted) throw new ModelError(stage, 'timeout', '模型响应超时，已停止本次请求。完整阶段仍保留，请稍后重试。');
    if (cause instanceof ModelError) throw cause;
    throw failure(stage, status);
  }
}
export async function requestJson<T extends z.ZodType>(settings: ModelSettings, systemPrompt: string, data: unknown, schema: T, signal: AbortSignal, stage: string, image?: string): Promise<z.infer<T>> {
  const content: Exclude<Context['messages'][number], { role: 'assistant' | 'toolResult' }>['content'] = [{ type: 'text', text: JSON.stringify(data) }];
  if (image) content.push({ type: 'image', mimeType: 'image/png', data: image.slice(image.indexOf(',') + 1) });
  const response = await requestModel(settings, {
    systemPrompt: systemPrompt + '\n\n使用 submit_result 返回本阶段结构化结果；所有必填字段均须提供。',
    tools: [{ name: 'submit_result', description: '返回完整阶段结果，必填字段不得省略；不直接保存项目。', parameters: z.toJSONSchema(z.strictObject({ result: schema })) as Tool['parameters'] }],
    messages: [{ role: 'user', content, timestamp: Date.now() }],
  }, signal, stage, false, 16384, 'submit_result');
  try {
    const calls = response.content.filter(block => block.type === 'toolCall');
    if (calls.length !== 1 || calls[0].name !== 'submit_result') throw new Error('缺少完整结果');
    return schema.parse(calls[0].arguments.result);
  }
  catch { throw new ModelError(stage, 'invalid-output', '模型输出不符合本阶段数据要求，最近保存的成果仍保留，请重试。'); }
}
export async function checkConnection(settings: ModelSettings, signal: AbortSignal) {
  await requestJson(settings, '这是连接检查，请返回 JSON。', { task: 'Return {"connected":true}.' }, z.strictObject({ connected: z.literal(true) }), signal, 'connection');
}
