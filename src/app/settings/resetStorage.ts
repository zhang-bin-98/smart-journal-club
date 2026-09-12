import { SettingsError } from './modelSettings';

/** 清理跨多种浏览器存储，失败不得宣称全部完成或恢复旧内存快照。 */
export function createStorageReset(clear: () => Promise<void>, isBusy: () => boolean) {
  let running = false;
  return async () => {
    if (running) throw new SettingsError('reset-busy', '正在清理，请等待。', '等待当前清理完成。');
    if (isBusy())
      throw new SettingsError('reset-busy', '任务正在运行，请等待完成或取消后再清理。', '返回任务完成或取消操作。');
    running = true;
    try {
      await clear();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '';
      const known = /^(请先关闭其他 smartJC|应用更新尚未完成|离线服务未响应|离线资源正在准备|当前浏览器无法检查)/.test(
        detail,
      );
      throw new SettingsError(
        'reset-failed',
        known ? detail : '清理未全部完成，可能已删除部分数据。请保留此页并重试。',
        '关闭其他应用窗口；若仍失败，使用浏览器站点数据管理检查存储。',
      );
    } finally {
      running = false;
    }
  };
}
