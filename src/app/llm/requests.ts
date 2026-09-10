import type { Context, Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { type ModelSettings, SettingsError } from '../settings/modelSettings';
import { ModelOutputError } from './modelError';
import type { ModelAdapter, ModelRequest } from './ports';

export function createModelRequests(adapter: ModelAdapter) {
  const requestModel = (input: ModelRequest) => adapter.request(input);
  async function requestJson<T extends z.ZodType>({
    settings,
    systemPrompt,
    data,
    schema,
    signal,
    stage,
    image,
    maxTokens = 16384,
  }: {
    settings: ModelSettings;
    systemPrompt: string;
    data: unknown;
    schema: T;
    signal: AbortSignal;
    stage: string;
    image?: string;
    maxTokens?: number;
  }): Promise<z.infer<T>> {
    const content: Exclude<Context['messages'][number], { role: 'assistant' | 'toolResult' }>['content'] = [
      { type: 'text', text: JSON.stringify(data) },
    ];
    if (image) content.push({ type: 'image', mimeType: 'image/png', data: image.slice(image.indexOf(',') + 1) });
    const response = await requestModel({
      settings: settings,
      context: {
        systemPrompt: `${systemPrompt}\n\n使用 submit_result 返回本阶段结构化结果；所有必填字段均须提供。`,
        tools: [
          {
            name: 'submit_result',
            description: '返回完整阶段结果，必填字段不得省略；不直接保存项目。',
            parameters: z.toJSONSchema(z.strictObject({ result: schema })) as Tool['parameters'],
          },
        ],
        messages: [{ role: 'user', content, timestamp: Date.now() }],
      },
      signal: signal,
      stage: stage,
      json: false,
      maxTokens,
      outputTool: 'submit_result',
    });
    const calls = response.content.filter((block) => block.type === 'toolCall');
    if (calls.length !== 1 || calls[0].name !== 'submit_result') {
      throw new ModelOutputError(stage, null, [
        { code: 'missing-result', path: '', message: '须返回一次 submit_result' },
      ]);
    }
    const raw = calls[0].arguments.result;
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new ModelOutputError(
        stage,
        raw,
        parsed.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    return parsed.data;
  }

  return { requestModel, requestJson };
}

/** 设置事务期间拒绝新请求，检查与工作流共用同一应用层保护。 */
export function guardModelRequests(adapter: ModelAdapter, isWriting: () => boolean): ModelAdapter {
  return {
    describe: adapter.describe,
    request(input) {
      if (isWriting()) throw new SettingsError('busy', '配置正在保存，请稍后再请求模型。');
      return adapter.request(input);
    },
  };
}
