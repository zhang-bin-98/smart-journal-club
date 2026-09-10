type Delta = { content?: string; tool_calls?: { id?: string; function: { name: string; arguments: string } }[] };

/** 复用既有测试内容，仅将固定返回编码为真实 Responses SSE。 */
export function responsesEvent(delta: Delta, _reason = 'stop') {
  const events: object[] = [];
  const output: object[] = [];
  events.push({ type: 'response.created', response: { id: 'resp-fixed', status: 'in_progress' } });
  if (delta.content !== undefined) {
    const item = {
      id: 'msg-fixed',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: delta.content, annotations: [] }],
    };
    events.push({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } });
    events.push({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: delta.content });
    events.push({ type: 'response.output_item.done', output_index: 0, item });
    output.push(item);
  }
  for (const [index, call] of (delta.tool_calls ?? []).entries()) {
    const item = {
      id: `fc-${index}`,
      call_id: call.id ?? `call-${index}`,
      type: 'function_call',
      name: call.function.name,
      arguments: call.function.arguments,
      status: 'completed',
    };
    events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, arguments: '' } });
    events.push({ type: 'response.function_call_arguments.delta', output_index: index, delta: item.arguments });
    events.push({ type: 'response.output_item.done', output_index: index, item });
    output.push(item);
  }
  events.push({
    type: 'response.completed',
    response: {
      id: 'resp-fixed',
      status: 'completed',
      output,
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    },
  });
  return events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
}

/** 既有主链的内容断言保持同一 fixture；协议合法性另由模型边界检查保护。 */
export function decodeResponseRequest(raw: {
  tools?: { name: string; parameters?: unknown }[];
  input: { type?: string; role?: string; content?: unknown; output?: unknown }[];
}) {
  return {
    ...raw,
    tools: (raw.tools ?? []).map((tool) => ({ function: tool })),
    messages: raw.input.map((item) => {
      if (item.type === 'function_call_output') return { role: 'tool', content: item.output };
      const content = Array.isArray(item.content)
        ? item.content.map((part) => ({
            ...part,
            type: part.type === 'input_text' || part.type === 'output_text' ? 'text' : part.type,
          }))
        : item.content;
      return {
        role: item.role,
        content:
          Array.isArray(content) && content.every((part) => part.type === 'text')
            ? content.map((part) => part.text).join('')
            : content,
      };
    }),
  };
}
