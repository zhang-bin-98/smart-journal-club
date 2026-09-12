import { useState } from 'react';
import { storageReset } from '../../app/composition';
import { SettingsError } from '../../app/settings/modelSettings';
import { Brand, Button, inputClass } from '../controls';

/** 独立入口不挂载项目及模型会话，清理后只能重新加载新的应用状态。 */
export function StorageResetPage() {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const returnToApp = () => location.replace(import.meta.env.BASE_URL);
  async function clear() {
    if (busy || done || confirmation !== '清除所有数据') return;
    setBusy(true);
    setError('');
    try {
      await storageReset();
      setDone(true);
    } catch (cause) {
      setError(cause instanceof SettingsError ? cause.message : '清理未完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-dvh min-w-[960px] bg-canvas p-8 text-ink" aria-label="清除本应用数据">
      <Brand />
      <section className="mx-auto mt-12 max-w-[720px] space-y-6 rounded-lg border border-line bg-white p-8">
        <h1 className="text-xl font-semibold">{done ? '本应用数据已清除' : '清除本应用所有本地数据'}</h1>
        {done ? (
          <>
            <p role="status" className="text-sm leading-7">
              项目、PDF、成果、历史记录、模型配置及 Key、应用缓存已清除。请联网重新打开应用；离线资源会重新下载。
            </p>
            <Button primary onClick={returnToApp}>
              重新打开应用
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm leading-7">
              此操作无法撤销，将删除当前浏览器中 smartJC 的全部项目、主论文与补充
              PDF、分析与图源修正、大纲与讲稿、当前及上一版幻灯片、候选稿、历史记录、模型配置及 API
              Key，以及本应用离线缓存。
            </p>
            <p className="text-sm leading-7 text-muted">
              电脑上已下载的 PDF、PPTX 和其他网站的数据不受影响。PPTX 不等于可恢复项目的备份。请先关闭其他 smartJC
              标签页和应用窗口；清理完成后需要联网重新打开。
            </p>
            <label className="block text-sm">
              输入“清除所有数据”以确认
              <input
                className={`${inputClass} mt-2`}
                autoComplete="off"
                disabled={busy}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <p role="status" aria-live="polite" className="text-sm text-red-700">
              {busy ? '正在清理，请勿关闭此页…' : error}
            </p>
            <div className="flex gap-3">
              <Button disabled={busy} onClick={returnToApp}>
                返回应用
              </Button>
              <Button
                disabled={busy || confirmation !== '清除所有数据'}
                className="border-red-700 text-red-700"
                onClick={() => void clear()}
              >
                {busy ? '正在清理…' : '永久清除所有数据'}
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
