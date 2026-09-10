import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettingsRecord,
  SettingsError,
  type ModelSettings,
} from './modelSettings';
export type SettingsStore = {
  read: () => Promise<unknown>;
  write: (settings: ModelSettings, expected?: ModelSettings) => Promise<void>;
  clearKey: (expected?: ModelSettings) => Promise<unknown>;
};
/** 同步占用配置写入锁，事务成功才发布新配置；失败保留已保存快照。 */
export function createSettingsService(
  store: SettingsStore,
  isBusy: () => boolean,
  acquireWrite: () => () => void = () => () => {},
) {
  let writing = false;
  async function command<T>(work: () => Promise<T>): Promise<T> {
    if (writing || isBusy()) throw new SettingsError('busy', '任务正在运行，请返回任务等待完成或取消后再修改配置。');
    const release = acquireWrite();
    writing = true;
    try {
      return await work();
    } catch (cause) {
      if (cause instanceof SettingsError) throw cause;
      throw new SettingsError('storage', '配置保存失败，请保留当前输入并检查本地存储后重试。');
    } finally {
      writing = false;
      release();
    }
  }
  return {
    isWriting: () => writing,
    async load() {
      try {
        return readSettingsRecord(await store.read());
      } catch (cause) {
        if (cause instanceof SettingsError) throw cause;
        throw new SettingsError('storage', '无法读取模型配置，请保留浏览器数据并重试。');
      }
    },
    save(input: ModelSettings, expected?: ModelSettings) {
      const next = normalizeSettings(input);
      return command(async () => {
        await store.write(next, expected);
        return next;
      });
    },
    clearKey(expected?: ModelSettings) {
      return command(async () => {
        const raw = await store.clearKey(expected);
        return raw === undefined ? { ...DEFAULT_SETTINGS } : readSettingsRecord(raw).settings;
      });
    },
  };
}
