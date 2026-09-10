import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { modelScheduler, settingsChecks, settingsService } from '../../app/composition';
import { hasRunningActivity, subscribeActivity } from '../../app/activity';
import { normalizeSettings, SettingsError, type ModelSettings } from '../../app/settings/modelSettings';
import { uncheckedResults } from '../../app/settings/settingsChecks';
import { ModelError } from '../../app/llm/modelError';

function capabilityImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#17364d';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText('7392', 50, 68);
  return canvas.toDataURL('image/png');
}

export function useSettingsController({
  settings,
  onSaved,
  onClose,
}: {
  settings: ModelSettings;
  onSaved: (settings: ModelSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState(uncheckedResults);
  const busy = useSyncExternalStore(subscribeActivity, hasRunningActivity);
  const scheduler = useSyncExternalStore(modelScheduler.subscribe, modelScheduler.snapshot);
  const operation = useRef<AbortController | undefined>(undefined);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  function invalidate() {
    epoch.current++;
    operation.current?.abort();
    operation.current = undefined;
    setChecking(false);
    setResults(uncheckedResults());
    setStatus('');
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (busy) {
      epoch.current++;
      operation.current?.abort();
      operation.current = undefined;
      setChecking(false);
      setResults(uncheckedResults());
      setStatus('');
    }
  }, [busy]);
  function change(next: ModelSettings) {
    invalidate();
    setDraft(next);
  }
  function restore() {
    invalidate();
    setDraft(settings);
  }
  function close() {
    if (savingRef.current) return;
    invalidate();
    onClose();
  }
  function message(cause: unknown) {
    return cause instanceof SettingsError || cause instanceof ModelError
      ? cause.message
      : '操作未完成，请检查配置及本地存储后重试。';
  }
  async function save(clearKey = false) {
    if (savingRef.current) return;
    invalidate();
    savingRef.current = true;
    setSaving(true);
    try {
      const next = await (clearKey ? settingsService.clearKey(settings) : settingsService.save(draft, settings));
      if (!mounted.current) return;
      onSaved(next);
      setDraft(next);
      if (clearKey) setStatus('已清除保存的 Key，其他已保存配置和项目成果保留。');
      else onClose();
    } catch (cause) {
      if (mounted.current) setStatus(message(cause));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function check(capabilities = false) {
    invalidate();
    const id = epoch.current;
    const controller = new AbortController();
    operation.current = controller;
    setChecking(true);
    setStatus(capabilities ? '正在逐项检查应用能力…' : '正在检查连接…');
    const active = () => mounted.current && epoch.current === id && !controller.signal.aborted && !hasRunningActivity();
    try {
      const normalized = normalizeSettings(draft);
      if (capabilities)
        await settingsChecks.capabilities(normalized, controller.signal, capabilityImage(), (key, result) => {
          if (active()) setResults((previous) => ({ ...previous, [key]: result }));
        });
      else await settingsChecks.connection(normalized, controller.signal);
      if (active())
        setStatus(
          capabilities
            ? '本次能力检查结束，请查看逐项结果。配置尚未保存。'
            : '连接成功；本次未检查完整应用能力，配置尚未保存。',
        );
    } catch (cause) {
      if (active()) setStatus(message(cause));
    } finally {
      if (active()) {
        setChecking(false);
        operation.current = undefined;
      }
    }
  }
  return {
    draft,
    busy,
    saving,
    checking,
    status,
    results,
    scheduler,
    change,
    restore,
    close,
    save,
    check,
    cancel: () => {
      invalidate();
      setStatus('已取消检查，迟到结果不会回填。');
    },
  };
}
