import { z } from 'zod';

export const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ModelSettingsSchema = z.strictObject({
  protocol: z.literal('responses'),
  baseUrl: z.string(),
  modelId: z.string(),
  apiKey: z.string(),
  reasoningEffort: z.enum(reasoningEfforts).nullable(),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;
export const DEFAULT_SETTINGS: ModelSettings = {
  protocol: 'responses',
  baseUrl: '',
  modelId: '',
  apiKey: '',
  reasoningEffort: null,
};

export class SettingsError extends Error {
  readonly stage = 'settings';
  constructor(
    public readonly code: string,
    message: string,
    public readonly recovery = '检查配置后重试，已保存配置和项目仍保留。',
  ) {
    super(message);
  }
}

/** 仅归一化末尾完整路径段；拒绝带凭据或可改变请求语义的 URL。 */
export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SettingsError('invalid-url', '请输入有效的 HTTP(S) Base URL。');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#]/.test(input)
  )
    throw new SettingsError('invalid-url', 'Base URL 只能使用 HTTP(S)，不能包含账号、查询参数或片段。');
  url.pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/responses$/, '')
    .replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function normalizeSettings(input: unknown): ModelSettings {
  const parsed = ModelSettingsSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError('invalid-settings', '配置字段不完整，请重新填写模型配置。');
  const value = parsed.data;
  const modelId = value.modelId.trim();
  if (!modelId) throw new SettingsError('missing-model', '请输入模型 ID。');
  return { ...value, baseUrl: normalizeBaseUrl(value.baseUrl), modelId, apiKey: value.apiKey.trim() };
}

/** 旧凭据保留在原记录，迁移草稿不向任何新主机复制密钥。 */
export function readSettingsRecord(raw: unknown): { settings: ModelSettings; legacy: boolean } {
  if (raw === undefined) return { settings: { ...DEFAULT_SETTINGS }, legacy: false };
  if (raw && typeof raw === 'object' && !('protocol' in raw) && 'modelId' in raw && 'apiKey' in raw)
    return { settings: { ...DEFAULT_SETTINGS }, legacy: true };
  return { settings: normalizeSettings(raw), legacy: false };
}

/** 在同一事务中复核设置基准，另一标签页保存后不能被旧表单覆盖。 */
export function assertSettingsBase(raw: unknown, expected?: ModelSettings) {
  if (!expected) return;
  const current = readSettingsRecord(raw).settings;
  if ((Object.keys(current) as (keyof ModelSettings)[]).some((key) => current[key] !== expected[key]))
    throw new SettingsError('stale-settings', '已保存配置已在其他页面变化，请返回后重新打开配置页再修改。');
}
