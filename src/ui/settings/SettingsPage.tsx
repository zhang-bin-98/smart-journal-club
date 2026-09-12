import { useRef, useEffect, useState } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, RotateCcw, Trash2 } from 'lucide-react';
import { normalizeBaseUrl, type ModelSettings } from '../../app/settings/modelSettings';
import { capabilityLabels, type Capability } from '../../app/settings/settingsChecks';
import { Brand, Button, inputClass, useOnline } from '../controls';
import { AppHeaderActions } from '../PwaNotice';
import { reasoningOptions } from '../../app/settings/reasoningOptions';
import { useSettingsController } from './useSettingsController';

export function SettingsPage(props: {
  settings: ModelSettings;
  legacy: boolean;
  returnLabel: string;
  onSaved: (settings: ModelSettings) => void;
  onClose: () => void;
}) {
  const controller = useSettingsController(props);
  const { draft, busy, saving, checking, change } = controller;
  const online = useOnline();
  const [visible, setVisible] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  let address = '填写有效 Base URL 后显示请求地址';
  try {
    address = `${normalizeBaseUrl(draft.baseUrl)}/responses`;
  } catch {
    /* 无效草稿不能发请求。 */
  }
  const disabled = busy || saving;
  return (
    <main
      aria-label="模型配置"
      className="fixed inset-0 z-30 flex h-dvh min-w-[960px] flex-col overflow-hidden bg-canvas"
    >
      <header className="flex h-20 shrink-0 items-center gap-6 border-b border-line bg-white px-8">
        <Brand />
        <div className="border-l border-line pl-6">
          <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
            模型配置
          </h1>
          <p className="mt-1 text-xs text-muted">{saving ? '正在保存…' : '全局设置 · 保存后用于后续请求'}</p>
        </div>
        <div className="ml-auto flex gap-3">
          <AppHeaderActions />
          <Button disabled={saving} onClick={controller.close}>
            <ArrowLeft size={15} />
            {props.returnLabel}
          </Button>
          <Button primary disabled={disabled || checking} onClick={() => void controller.save()}>
            <Check size={15} />
            保存并返回
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(500px,1.55fr)_minmax(320px,1fr)] gap-6">
          <section aria-label="连接配置" className="rounded-lg border border-line bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">连接配置</h2>
              <span className="rounded bg-accent-soft px-3 py-1 text-xs text-accent">Responses API</span>
            </div>
            {props.legacy && (
              <p role="status" className="mt-5 rounded border border-line bg-panel p-3 text-sm leading-relaxed">
                检测到旧模型配置，原记录已保留。请填写 Responses 地址、模型和 Key；旧凭据不会自动复制到新地址。
              </p>
            )}
            <fieldset disabled={disabled} className="mt-6 space-y-5">
              <label className="block text-sm">
                Base URL
                <input
                  className={`${inputClass} mt-2`}
                  autoComplete="off"
                  placeholder="https://your-service.example/v1"
                  value={draft.baseUrl}
                  onChange={(event) => change({ ...draft, baseUrl: event.target.value })}
                />
              </label>
              <p className="-mt-3 break-all text-xs leading-relaxed text-muted">请求地址：{address}</p>
              <div>
                <label className="block text-sm" htmlFor="model-key">
                  API Key
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="model-key"
                    type={visible ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    className={inputClass}
                    value={draft.apiKey}
                    onChange={(event) => change({ ...draft, apiKey: event.target.value })}
                  />
                  <Button aria-label={visible ? '隐藏 Key' : '显示 Key'} onClick={() => setVisible(!visible)}>
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
              <label className="block text-sm">
                模型 ID
                <input
                  className={`${inputClass} mt-2`}
                  autoComplete="off"
                  placeholder="填写服务提供的模型 ID"
                  value={draft.modelId}
                  onChange={(event) => change({ ...draft, modelId: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                思考强度
                <select
                  aria-label="思考强度"
                  className={`${inputClass} mt-2`}
                  value={draft.reasoningEffort ?? ''}
                  onChange={(event) =>
                    change({
                      ...draft,
                      reasoningEffort: (event.target.value || null) as ModelSettings['reasoningEffort'],
                    })
                  }
                >
                  <option value="">服务默认</option>
                  {reasoningOptions(draft).map((effort) => (
                    <option key={effort.value} value={effort.value}>
                      {effort.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="-mt-3 text-xs leading-relaxed text-muted">
                服务默认不发送强度参数。显式档位须以当前服务检查为准；更高强度可能增加时间和费用，不保证质量更好。
              </p>
            </fieldset>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={disabled || checking || !online} onClick={() => void controller.check()}>
                <Check size={15} />
                测试连接
              </Button>
              <Button disabled={disabled || checking || !online} onClick={() => void controller.check(true)}>
                检查应用所需能力
              </Button>
              {checking && <Button onClick={controller.cancel}>取消检查</Button>}
            </div>
            <div role="status" aria-live="polite" className="mt-5 min-h-12 text-sm leading-relaxed">
              {busy ? '任务正在运行。请返回任务等待完成或取消后再修改配置。' : controller.status}
              {!online && <p className="text-muted">当前离线，可保存或清除配置；联网后再检查。</p>}
              {checking && controller.scheduler.queued > 0 && (
                <p className="text-muted">
                  {controller.scheduler.waitingUntil ? '正在等待请求限额恢复…' : '请求排队中…'}
                </p>
              )}
            </div>
            <div className="mt-5 flex gap-3 border-t border-line pt-5">
              <Button
                disabled={disabled || checking || (!props.settings.apiKey && !props.legacy)}
                onClick={() => void controller.save(true)}
              >
                <Trash2 size={15} />
                清除已保存 Key
              </Button>
              <Button disabled={disabled} onClick={controller.restore}>
                <RotateCcw size={15} />
                恢复已保存配置
              </Button>
            </div>
          </section>
          <aside className="space-y-6">
            <section className="rounded-lg border border-line bg-white p-6">
              <h2 className="text-base font-semibold">连接 / 能力检查结果</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                测试使用当前输入与固定小素材，不包含项目论文，也不会自动保存配置。
              </p>
              <ul className="mt-5 divide-y divide-line">
                {(Object.keys(capabilityLabels) as Capability[]).map((key) => (
                  <li key={key} className="py-4">
                    <div className="flex justify-between gap-4 text-sm">
                      <span>{capabilityLabels[key]}</span>
                      <strong
                        className={
                          controller.results[key].status === 'passed'
                            ? 'text-success'
                            : controller.results[key].status === 'failed'
                              ? 'text-red-700'
                              : 'font-normal text-muted'
                        }
                      >
                        {{ passed: '通过', failed: '失败', unchecked: '未检查' }[controller.results[key].status]}
                      </strong>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{controller.results[key].message}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-line bg-white p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <KeyRound size={17} />
                生效范围与数据去向
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted">
                配置对所有项目生效，只影响后续模型请求。保存后返回原页面，不会开始或继续论文任务，也不会改写已有稿。
              </p>
              <p className="mt-3 text-sm leading-7 text-muted">
                必要文本与图片直接发送到你填写的服务地址。Key 只保存在当前浏览器，不进入项目、日志或导出；清除 Key
                后仍可本地查看、编辑和导出。
              </p>
            </section>
            <section aria-label="本地数据管理" className="rounded-lg border border-red-200 bg-white p-6">
              <h2 className="text-base font-semibold">本地数据管理</h2>
              <p className="my-4 text-sm leading-7 text-muted">
                永久删除本应用全部项目、PDF、成果、模型配置及 Key
                和离线缓存。下一页将说明范围并要求确认，当前未保存配置将丢弃。
              </p>
              <Button disabled={disabled || checking} onClick={() => controller.openStorageReset()}>
                <Trash2 size={15} />
                清除本应用所有数据
              </Button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
