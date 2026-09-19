import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  assertSettingsBase,
  normalizeBaseUrl,
  normalizeSettings,
  readSettingsRecord,
} from '../../src/app/settings/modelSettings';
import { createSettingsService } from '../../src/app/settings/settingsService';
const settings = {
  ...DEFAULT_SETTINGS,
  baseUrl: 'https://models.example/custom/v1/responses/',
  modelId: ' model ',
  apiKey: ' secret ',
};

describe('全局配置唯一契约与提交', () => {
  it('已有 Responses 配置缺少 Token 字段时沿用默认且只读迁移不改写凭据', () => {
    const { contextWindow: _context, maxOutputTokens: _output, ...old } = settings;
    const loaded = readSettingsRecord(old);
    expect(loaded).toEqual({ settings: normalizeSettings(settings), legacy: false });
    expect(old).not.toHaveProperty('contextWindow');
    expect(old.apiKey).toBe(' secret ');
    expect(() => assertSettingsBase(old, loaded.settings)).not.toThrow();
    expect(() => assertSettingsBase({ ...old, maxOutputTokens: 65536 }, loaded.settings)).toThrow(/其他页面变化/);
  });
  it('Token 允许留空和大容量整数，拒绝非法数值及没有输入空间的配置', () => {
    expect(normalizeSettings({ ...settings, contextWindow: 1048576, maxOutputTokens: 131072 })).toMatchObject({
      contextWindow: 1048576,
      maxOutputTokens: 131072,
    });
    for (const contextWindow of [0, -1, 1.5, Infinity, NaN, '131072', Number.MAX_SAFE_INTEGER + 1])
      expect(() => normalizeSettings({ ...settings, contextWindow })).toThrow(/上下文窗口/);
    for (const maxOutputTokens of [0, -1, 15, 16.5, Infinity, NaN, '65536', 131072])
      expect(() => normalizeSettings({ ...settings, maxOutputTokens })).toThrow(/Token/);
    expect(normalizeSettings({ ...settings, maxOutputTokens: 16 }).maxOutputTokens).toBe(16);
    expect(normalizeSettings(settings).maxOutputTokens).toBeNull();
  });
  it('保留自定义路径，拒绝凭据、非 HTTP(S)、查询和片段', () => {
    expect(normalizeSettings(settings)).toMatchObject({
      baseUrl: 'https://models.example/custom/v1',
      modelId: 'model',
      apiKey: 'secret',
      reasoningEffort: null,
    });
    expect(normalizeBaseUrl('https://models.example/responses-proxy/v1///')).toBe(
      'https://models.example/responses-proxy/v1',
    );
    for (const value of [
      'file:///v1',
      'https://user:pass@host/v1',
      'https://host/v1?q=a',
      'https://host/v1#x',
      'https://host/?',
      'invalid',
    ])
      expect(() => normalizeBaseUrl(value)).toThrow();
  });
  it('旧配置读取幂等且不自动复制密钥或改成已验证新配置', () => {
    const old = { modelId: 'deepseek-v4-flash-vision-exp', apiKey: 'old-key' };
    expect(readSettingsRecord(old)).toEqual({ settings: DEFAULT_SETTINGS, legacy: true });
    expect(readSettingsRecord(old)).toEqual(readSettingsRecord(old));
    expect(old.apiKey).toBe('old-key');
  });
  it('保存失败保留旧值与草稿；运行中及重复保存拒绝执行存储', async () => {
    let saved = normalizeSettings(settings);
    let busy = true;
    let fail = false;
    const store = {
      read: async () => saved,
      write: vi.fn(async (next) => {
        if (fail) throw new Error('raw secret');
        saved = next;
      }),
      clearKey: vi.fn(),
    };
    const service = createSettingsService(store, () => busy);
    await expect(service.save(settings)).rejects.toMatchObject({ code: 'busy' });
    expect(store.write).not.toHaveBeenCalled();
    busy = false;
    fail = true;
    const draft = { ...settings, modelId: 'new-model' };
    await expect(service.save(draft)).rejects.toMatchObject({ code: 'storage' });
    expect(saved.modelId).toBe('model');
    expect(draft.modelId).toBe('new-model');
    fail = false;
    const first = service.save(draft);
    await expect(service.save(settings)).rejects.toMatchObject({ code: 'busy' });
    await first;
    expect(saved.modelId).toBe('new-model');
  });
  it('清除只处理保存值，不将表单草稿合入提交', async () => {
    const saved = normalizeSettings(settings);
    const clearKey = vi.fn(async () => ({ ...saved, apiKey: '' }));
    const write = vi.fn();
    const service = createSettingsService({ read: async () => saved, write, clearKey }, () => false);
    expect(await service.clearKey()).toEqual({ ...saved, apiKey: '' });
    expect(write).not.toHaveBeenCalled();
  });
});
