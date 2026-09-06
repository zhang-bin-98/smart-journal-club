import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { model, ModelError, requestModel, type ModelSettings } from '../../../shared/llm/model';

/** 将已有供应商适配器接入 Agent 流协议；错误体和隐藏推理不进入 UI 事件。 */
export function assistantStream(settings: ModelSettings): StreamFn {
  return (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    const signal = options?.signal ?? new AbortController().signal;
    stream.push({ type: 'start', partial });
    stream.push({ type: 'text_start', contentIndex: 0, partial });
    void requestModel(settings, context, signal, 'ai', false, 16384, undefined, (delta) => {
      const block = partial.content[0];
      if (block.type === 'text') block.text += delta;
      stream.push({ type: 'text_delta', contentIndex: 0, delta, partial });
    }).then(
      (message) => {
        const block = partial.content[0];
        stream.push({ type: 'text_end', contentIndex: 0, content: block.type === 'text' ? block.text : '', partial });
        if (message.stopReason === 'error' || message.stopReason === 'aborted')
          stream.push({ type: 'error', reason: message.stopReason, error: message });
        else if (message.stopReason === 'pending')
          stream.push({
            type: 'error',
            reason: 'error',
            error: { ...message, stopReason: 'error', errorMessage: '模型未完成响应。' },
          });
        else stream.push({ type: 'done', reason: message.stopReason, message });
      },
      (cause) => {
        const reason = signal.aborted ? 'aborted' : 'error';
        stream.push({
          type: 'error',
          reason,
          error: {
            ...partial,
            content: [],
            stopReason: reason,
            errorMessage: signal.aborted
              ? '已取消本次请求'
              : cause instanceof ModelError
                ? cause.message
                : '模型请求失败，请重试。',
          },
        });
      },
    );
    return stream;
  };
}
