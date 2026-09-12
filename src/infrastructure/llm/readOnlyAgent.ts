import { Agent } from '@earendil-works/pi-agent-core';
import { createAssistantStream } from './assistantStream';
import type { ModelAdapter } from '../../app/llm/ports';

import type { ReadAgent } from '../../app/paper/paperAssistant';
import { ModelError } from '../../app/llm/modelError';

/** 沿用 Pi 的事件、工具选择及取消，不维护第二套 Agent loop。 */
export const createReadOnlyAgent =
  (adapter: ModelAdapter): ReadAgent =>
  async ({ settings, prompt, context, tools, signal, onText }) => {
    let turns = 0;
    let calls = 0;
    let text = '';
    const agent = new Agent({
      initialState: {
        model: adapter.describe(settings),
        systemPrompt: prompt,
        tools: tools.map((tool) => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (_id, args) => {
            signal.throwIfAborted();
            const result = tool.execute(args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
          },
        })),
      },
      streamFn: createAssistantStream(settings, adapter.request, adapter.describe),
      toolExecution: 'sequential',
      beforeToolCall: async () => {
        signal.throwIfAborted();
        calls++;
        return calls > 12 ? { block: true, reason: '本次读取已达上限，请缩小问题范围。', terminate: true } : undefined;
      },
      shouldStopAfterTurn: () => ++turns >= 6,
    });
    const unsubscribe = agent.subscribe((event) => {
      if (!signal.aborted && event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        text += event.assistantMessageEvent.delta;
        onText(text);
      }
    });
    const abort = () => agent.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await agent.prompt(JSON.stringify(context));
      signal.throwIfAborted();
      const last = [...agent.state.messages].reverse().find((message) => message.role === 'assistant');
      if (agent.state.errorMessage || last?.role !== 'assistant' || last.stopReason !== 'stop')
        throw new ModelError('paper-assistant', 'incomplete-answer', '本次问答未完成，请重试。');
      const answer = last.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n')
        .trim();
      if (!answer) throw new ModelError('paper-assistant', 'empty-answer', '未收到有效回答，请重试。');
      return answer;
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
    }
  };
