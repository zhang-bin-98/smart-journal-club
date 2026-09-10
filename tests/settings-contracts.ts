import { settingsService } from '../src/app/composition';
import { DEFAULT_SETTINGS } from '../src/app/settings/modelSettings';
import { get, transaction } from '../src/shared/persistence/indexedDb';

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
export async function settingsContracts() {
  const before = await transaction(['settings'], 'readonly', async (tx) => ({
    model: await get(tx, 'settings', 'model'),
    legacy: await get(tx, 'settings', 'legacy-model'),
  }));
  const legacy = { modelId: 'deepseek-v4-flash-vision-exp', apiKey: 'fixed-old-secret' };
  const draft = {
    ...DEFAULT_SETTINGS,
    baseUrl: 'https://models.example/path',
    modelId: 'fixture',
    apiKey: 'fixed-new-secret',
  };
  const readRaw = () =>
    transaction(['settings'], 'readonly', async (tx) => ({
      model: await get(tx, 'settings', 'model'),
      legacy: await get(tx, 'settings', 'legacy-model'),
    }));
  const original = IDBObjectStore.prototype.put;
  try {
    await transaction(['settings'], 'readwrite', async (tx) => {
      tx.objectStore('settings').put(legacy, 'model');
      tx.objectStore('settings').delete('legacy-model');
    });
    assert((await settingsService.load()).legacy, '旧配置应标记待迁移');
    assert(!(await settingsService.load()).settings.apiKey, '不能复制旧凭据到新配置');
    assert(JSON.stringify((await readRaw()).model) === JSON.stringify(legacy), '只读加载不得覆盖旧配置');
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'settings' && key === 'model') throw new DOMException('fixed', 'QuotaExceededError');
      return original.call(this, value, key);
    };
    let failed = false;
    try {
      await settingsService.save(draft, DEFAULT_SETTINGS);
    } catch {
      failed = true;
    }
    assert(failed, '保存失败必须抛出');
    IDBObjectStore.prototype.put = original;
    assert(JSON.stringify(await readRaw()) === JSON.stringify({ model: legacy }), '写入失败应回滚备份和新配置');
    const saved = await settingsService.save(draft, DEFAULT_SETTINGS);
    assert(JSON.stringify((await readRaw()).legacy) === JSON.stringify(legacy), '成功迁移保留原配置');
    let stale = false;
    try {
      await settingsService.save({ ...draft, modelId: 'stale' }, DEFAULT_SETTINGS);
    } catch (cause) {
      stale = (cause as { code: string }).code === 'stale-settings';
    }
    assert(stale && (await settingsService.load()).settings.modelId === 'fixture', '旧配置基准不得覆盖另一页面保存值');
    await settingsService.clearKey(saved);
    const cleared = await readRaw();
    assert(
      (cleared.model as { apiKey: string }).apiKey === '' && (cleared.legacy as { apiKey: string }).apiKey === '',
      '清除覆盖当前和旧备份凭据',
    );
    assert((await settingsService.load()).settings.baseUrl === draft.baseUrl, '清除凭据不清除地址');
    return 'PASS: settings legacy read/atomic backup/rollback/stale base/clear current and backup';
  } finally {
    IDBObjectStore.prototype.put = original;
    await transaction(['settings'], 'readwrite', async (tx) => {
      for (const [key, value] of [
        ['model', before.model],
        ['legacy-model', before.legacy],
      ] as const) {
        if (value === undefined) tx.objectStore('settings').delete(key);
        else tx.objectStore('settings').put(value, key);
      }
    });
  }
}
