import { get, transaction } from '../persistence/indexedDb';
import { DEFAULT_SETTINGS, ModelSettingsSchema, type ModelSettings } from './model';

export function loadSettings() {
  return transaction(['settings'], 'readonly', async tx => ModelSettingsSchema.parse(await get(tx, 'settings', 'model') ?? DEFAULT_SETTINGS));
}
export function saveSettings(settings: ModelSettings) {
  const next = ModelSettingsSchema.parse({ ...settings, apiKey: settings.apiKey.trim() });
  return transaction(['settings'], 'readwrite', async tx => { tx.objectStore('settings').put(next, 'model'); return next; });
}
