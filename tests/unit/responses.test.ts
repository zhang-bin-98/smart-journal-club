import { normalizeSettings } from '../../src/app/settings/modelSettings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResponsesAdapter, responsePayload } from '../../src/infrastructure/llm/responses';
import { RequestScheduler } from '../../src/infrastructure/llm/requestScheduler';
import { DEFAULT_SETTINGS, reasoningEfforts } from '../../src/app/settings/modelSettings';
import { responsesEvent } from '../responses-fixture';

const request = () => ({
  settings: {
    ...DEFAULT_SETTINGS,
    baseUrl: 'https://models.example/custom/v1',
    modelId: 'fixture',
    apiKey: 'private-key',
  },
  signal: new AbortController().signal,
  context: { messages: [] },
  stage: 'test',
});
describe('Pi Responses 适配边界', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('服务默认省略 reasoning；每个显式值保持原样', () => {
    const input = request();
    expect(
      responsePayload({ reasoning: { effort: 'none' }, include: ['reasoning.encrypted_content'] }, input),
    ).not.toHaveProperty('reasoning');
    for (const effort of reasoningEfforts)
      expect(responsePayload({}, { ...input, settings: { ...input.settings, reasoningEffort: effort } })).toMatchObject(
        { reasoning: { effort } },
      );
  });
  it('真实 SDK 发送到 Responses 路径，保留图片/工具/流且无 SDK 自动重试', async () => {
    const payloads: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://models.example/custom/v1/responses');
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(
        responsesEvent({ tool_calls: [{ function: { name: 'paper__read', arguments: '{"value":true}' } }] }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const adapter = createResponsesAdapter(new RequestScheduler(), normalizeSettings);
    const result = await adapter.request({
      ...request(),
      outputTool: 'paper.read',
      context: {
        tools: [{ name: 'paper.read', description: 'read', parameters: { type: 'object', properties: {} } }],
        messages: [
          {
            role: 'user',
            timestamp: 0,
            content: [
              { type: 'text', text: 'test' },
              { type: 'image', mimeType: 'image/png', data: 'fixed-image' },
            ],
          },
        ],
      },
    });
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'toolCall', name: 'paper.read', arguments: { value: true } }),
    );
    expect(payloads[0]).toMatchObject({
      stream: true,
      model: 'fixture',
      tool_choice: 'auto',
    });
    expect(JSON.stringify(payloads[0])).toContain('input_image');
    expect(payloads[0]).not.toHaveProperty('reasoning');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 500])('认证、未知 429 和服务错误不叠加 SDK 重试，错误不回显秘密 (%i)', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'unknown', message: 'private-key provider detail' } }), {
          status,
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const adapter = createResponsesAdapter(new RequestScheduler(), normalizeSettings);
    const result = await adapter.request(request()).catch((cause) => cause);
    expect(result.message).not.toContain('private-key');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('老龄队列论文第 4 页：思考耗尽输出预算的真实结束事件识别为截断', async () => {
    // 2026-09-19 aging 样例的脱敏响应元数据；不包含原文、凭据或隐藏推理。
    const response = {
      id: 'aging-page-4',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
      usage: {
        input_tokens: 4782,
        output_tokens: 16384,
        output_tokens_details: { reasoning_tokens: 16384 },
        total_tokens: 21166,
      },
    };
    const events = [
      { type: 'response.created', response: { id: response.id, status: 'in_progress' } },
      { type: 'response.incomplete', response },
    ];
    const fetcher = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({ max_output_tokens: 16384, reasoning: { effort: 'high' } });
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const adapter = createResponsesAdapter(new RequestScheduler(), normalizeSettings);
    const input = request();
    await expect(
      adapter.request({ ...input, stage: 'figures', settings: { ...input.settings, reasoningEffort: 'high' } }),
    ).rejects.toMatchObject({ stage: 'figures', code: 'truncated' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
