/** 通用 Responses 端点未声明 tokenizer；这是容量估算，不是供应商精确计数或速率限制。 */
export function estimateContextTokens(context: unknown, schema?: unknown): number {
  let images = 0;
  const serialized = JSON.stringify(context, (_key, value) => {
    if (value && typeof value === 'object' && value.type === 'image') {
      images++;
      return '[image]';
    }
    return value;
  });
  return Math.ceil((serialized.length + (schema ? JSON.stringify(schema).length : 0)) / 2) + images * 4096;
}
