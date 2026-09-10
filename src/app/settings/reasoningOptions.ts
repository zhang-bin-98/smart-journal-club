import { normalizeBaseUrl, reasoningEfforts, type ModelSettings } from './modelSettings';

/** 已核对的端点能力只约束选项展示，适配器仍原样发送用户保存的值。 */
export function reasoningOptions(settings: ModelSettings) {
  let base = '';
  try {
    base = normalizeBaseUrl(settings.baseUrl);
  } catch {
    /* 无效草稿不推测服务身份。 */
  }
  const known =
    ['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(base) &&
    ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(
      settings.modelId.trim(),
    );
  // DeepSeek 官方 Responses 契约：none/low/high/max；其余值是服务端兼容映射。
  const values = known ? (['none', 'low', 'high', 'max'] as const) : reasoningEfforts;
  return reasoningEfforts
    .filter((value) => (values as readonly string[]).includes(value) || value === settings.reasoningEffort)
    .map((value) => ({
      value,
      label: known && (values as readonly string[]).includes(value) ? value : `${value} · 待验证`,
    }));
}
