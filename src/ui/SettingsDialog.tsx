import { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, Trash2, X } from 'lucide-react';
import { checkConnection, type ModelSettings } from '../model';
import { saveSettings } from '../shared/llm/settingsRepository';
import { beginActivity } from '../activity';
import { Button, errorMessage, IconButton, inputClass, useOnline } from './controls';

export function SettingsDialog({ settings, onSaved, onClose }: { settings: ModelSettings; onSaved: (settings: ModelSettings) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(settings.apiKey);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const online = useOnline();
  const [status, setStatus] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => { operation.current?.abort(); node.close(); }; }, []);
  async function save(apiKey: string) {
    if (savingRef.current) return; savingRef.current = true; setSaving(true); const done = beginActivity();
    try { onSaved(await saveSettings({ ...settings, apiKey })); onClose(); }
    catch (cause) { setStatus(errorMessage(cause)); }
    finally { savingRef.current = false; setSaving(false); done(); }
  }
  return <dialog ref={dialog} aria-label="模型设置" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} className="fixed inset-0 m-auto w-[min(500px,94vw)] max-w-none rounded-md border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-black/35">
    <header className="flex items-center justify-between"><h2 className="text-base font-semibold">模型设置</h2><IconButton label="关闭模型设置" disabled={saving} onClick={onClose}><X size={16} /></IconButton></header>
    <label className="mt-5 block text-sm">模型<select className={`${inputClass} mt-2`} value={settings.modelId} disabled={checking || saving} onChange={() => {}}><option value={settings.modelId}>DeepSeek V4 Flash Vision</option></select></label>
    <label className="mt-4 block text-sm">API Key<input type="password" autoComplete="off" className={`${inputClass} mt-2`} aria-label="API Key" value={key} disabled={checking || saving} onChange={event => { setKey(event.target.value); setStatus(''); }} /></label>
    <p className="mt-4 text-xs leading-relaxed text-muted">论文分析所需文本和图片将直接发送给 DeepSeek。Key 保存在当前浏览器，可单独清除。清除站点数据可能删除本地项目，PPTX 导出不等于项目备份。</p>
    {!online && <p role="status" className="mt-3 text-xs text-muted">当前离线，联网后可测试连接；仍可保存或清除 Key。</p>}
    {status && <p role="status" className="mt-3 text-sm">{status}</p>}
    <footer className="mt-5 flex flex-wrap justify-end gap-2"><Button disabled={checking || saving || !key.trim() || !online} onClick={async () => {
      const done = beginActivity(); const controller = new AbortController(); operation.current = controller; setChecking(true); setStatus('正在检查连接…');
      try { await checkConnection({ ...settings, apiKey: key.trim() }, controller.signal); if (!controller.signal.aborted) setStatus('连接成功'); }
      catch (cause) { if (!controller.signal.aborted) setStatus(errorMessage(cause)); }
      finally { if (!controller.signal.aborted) setChecking(false); done(); }
    }}><Check size={15} />测试连接</Button><Button disabled={checking || saving || !settings.apiKey} onClick={() => void save('')}><Trash2 size={15} />清除 Key</Button><Button primary disabled={checking || saving} onClick={() => void save(key)}><KeyRound size={15} />保存</Button></footer>
  </dialog>;
}
