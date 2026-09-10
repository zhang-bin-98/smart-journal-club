import { get, transaction } from '../../shared/persistence/indexedDb';
import { assertSettingsBase } from '../../app/settings/modelSettings';
import type { SettingsStore } from '../../app/settings/settingsService';
export const settingsStore: SettingsStore = {
  read: () => transaction(['settings'], 'readonly', (tx) => get(tx, 'settings', 'model')),
  write: (next, expected) =>
    transaction(['settings'], 'readwrite', async (tx) => {
      const previous = await get<Record<string, unknown>>(tx, 'settings', 'model');
      assertSettingsBase(previous, expected);
      const backup = await get(tx, 'settings', 'legacy-model');
      if (previous && !('protocol' in previous) && backup === undefined)
        tx.objectStore('settings').put(previous, 'legacy-model');
      tx.objectStore('settings').put(next, 'model');
    }),
  clearKey: (expected) =>
    transaction(['settings'], 'readwrite', async (tx) => {
      assertSettingsBase(await get(tx, 'settings', 'model'), expected);
      let current: unknown;
      for (const key of ['model', 'legacy-model']) {
        const saved = await get<Record<string, unknown>>(tx, 'settings', key);
        if (!saved) continue;
        const next = { ...saved, apiKey: '' };
        tx.objectStore('settings').put(next, key);
        if (key === 'model') current = next;
      }
      return current;
    }),
};
