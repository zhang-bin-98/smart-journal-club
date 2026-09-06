import { useEffect, useId, useRef, useState } from 'react';
import { Bot, CircleStop, Send, Undo2 } from 'lucide-react';
import type { ModelSettings } from '../../model';
import type { ChatMessage } from '../../modules/assistant/assistant.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import type { Project } from '../../modules/project/project.schema';
import type { DeckSession } from '../../deck';
import { runAiRevision } from '../../ai';
import { loadHistory } from '../../modules/assistant/conversationRepository';
import { beginActivity, setDirty } from '../../activity';
import { Button, errorMessage, inputClass, useOnline } from '../controls';

export type CancelAi = (reason?: 'manual') => boolean;
export function AiPanel({ session, paper, settings, projectId, preferences, selectedSlideId, selectedElementId, onChanged, beforeSend, beforeUndo, onBusyChange, registerCancel, disabled = false }: {
  disabled?: boolean; session: DeckSession; paper: Paper; settings: ModelSettings; projectId?: string; preferences?: Project['preferences']; selectedSlideId?: string; selectedElementId?: string;
  onChanged: () => void; beforeSend: () => Promise<void>; beforeUndo: () => Promise<void>; onBusyChange: (busy: boolean) => void; registerCancel: (cancel?: CancelAi) => void;
}) {
  const [input, setInput] = useState('');
  const online = useOnline();
  const inputKey = useId();
  const changeInput = (value: string) => { setDirty(inputKey, !!value.trim()); setInput(value); };
  useEffect(() => () => setDirty(inputKey, false), [inputKey]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!projectId);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const task = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const messageList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; task.current?.abort(); task.current = undefined; registerCancel(); onBusyChange(false); };
  }, [registerCancel, onBusyChange]);
  useEffect(() => {
    let active = true;
    if (!projectId) { setLoading(false); return; }
    setLoading(true); setHistoryError('');
    loadHistory(projectId).then(saved => { if (active) { setMessages(saved); setLoading(false); } }, cause => {
      if (active) { setHistoryError(errorMessage(cause)); setLoading(false); }
    });
    return () => { active = false; };
  }, [projectId, historyAttempt]);
  useEffect(() => { messageList.current?.scrollTo({ top: messageList.current.scrollHeight }); }, [messages, pendingMessage, busy, error]);
  function cancel(reason?: 'manual') {
    const controller = task.current;
    if (!controller) return false;
    task.current = undefined;
    controller.abort(); registerCancel(); setBusy(false); onBusyChange(false); setPendingMessage('');
    setNotice(reason === 'manual' ? '' : '已取消本次请求');
    return true;
  }
  async function send() {
    const request = input.trim(); if (!request || task.current || loading || historyError || disabled || !online) return;
    if (!settings.apiKey.trim()) { setError('请先在模型设置中配置 API Key。'); return; }
    const done = beginActivity(); const controller = new AbortController(); task.current = controller; setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try {
      await beforeSend();
      if (!mounted.current || task.current !== controller || controller.signal.aborted) return;
      registerCancel(cancel); changeInput(''); setPendingMessage(request);
      const result = await runAiRevision({
        settings, paper, deck: session.current, session, projectId, preferences, request, selectedSlideId, selectedElementId,
        recentMessages: messages, signal: controller.signal, isTaskActive: () => mounted.current && task.current === controller,
      });
      if (!mounted.current) return;
      // A completed database transaction remains a real result even if cancellation arrived afterwards.
      setMessages(value => [...value.filter(message => !result.messages.some(next => next.id === message.id)), ...result.messages].slice(-100));
      if (result.committed) onChanged();
    } catch (cause) {
      if (mounted.current && task.current === controller && !controller.signal.aborted) { setError(errorMessage(cause)); changeInput(request); }
    } finally {
      done();
      if (mounted.current && task.current === controller) {
        task.current = undefined; registerCancel(); setBusy(false); onBusyChange(false); setPendingMessage('');
      }
    }
  }
  function canUndo(message: ChatMessage) {
    return message.revision !== undefined && message.deckId === session.current.id && message.revision === session.current.revision && session.canUndo;
  }
  async function undoRevision(message: ChatMessage) {
    if (task.current || disabled || !canUndo(message)) return;
    const done = beginActivity();
    try {
      await beforeUndo();
      if (!canUndo(message)) return;
      await session.undo(); onChanged(); setError('');
    } catch (cause) { setError(errorMessage(cause)); } finally { done(); }
  }
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-panel p-4" aria-label="AI 助手">
    <div className="flex items-center gap-2"><Bot size={17} /><h2 className="text-sm font-semibold">AI 助手</h2></div>
    <div ref={messageList} className="mt-3 min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain" aria-live="polite" aria-busy={busy || loading}>
      {loading && <p role="status" className="text-xs text-muted">正在读取对话…</p>}
      {!loading && !messages.length && <p className="text-xs leading-relaxed text-muted">可以询问图表、逻辑或证据，也可以明确要求修改当前页。</p>}
      {messages.map(message => <div key={message.id} className={`text-xs leading-relaxed ${message.role === 'user' ? 'border-l-2 border-accent pl-2' : 'border-l-2 border-line pl-2'}`}>
        <p className="mb-1 text-[11px] text-muted">{message.role === 'user' ? '你' : 'AI 助手'}</p>
        <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>
        {message.summary && <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-muted">修改摘要：{message.summary}</p>}
        {!!message.affectedSlideIds?.length && <p className="mt-1 text-muted">受影响页：{message.affectedSlideIds.map(id => { const index = session.current.slides.findIndex(slide => slide.id === id); return index < 0 ? '已删除页' : `第 ${index + 1} 页`; }).join('、')}</p>}
        {message.revision !== undefined && <Button className="mt-2" disabled={!canUndo(message) || busy || disabled} onClick={() => void undoRevision(message)}><Undo2 size={14} />撤销本次修改</Button>}
      </div>)}
      {pendingMessage && <div className="border-l-2 border-accent pl-2 text-xs leading-relaxed"><p className="mb-1 text-[11px] text-muted">你</p><p className="whitespace-pre-wrap wrap-anywhere">{pendingMessage}</p></div>}
      {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted"><CircleStop size={14} className="animate-pulse" />正在调整…</p>}
    </div>
    {historyError && <div role="alert" className="mt-3 text-xs text-red-700"><p>读取对话失败：{historyError}</p><Button className="mt-2" onClick={() => setHistoryAttempt(value => value + 1)}>重试读取</Button></div>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-muted">{notice}</p>}
    <div className="mt-4 shrink-0 border-t border-line pt-3">
      {!online && <p role="status" className="mb-2 text-xs text-muted">当前离线，联网后可使用 AI；本地编辑和导出仍可用。</p>}
      {!settings.apiKey.trim() && <p className="mb-2 text-xs text-muted">请先通过顶栏的“模型设置”配置 Key。</p>}
      <textarea aria-label="AI 输入" className={`${inputClass} min-h-24 max-h-48 resize-y`} placeholder="告诉我怎么调整…" value={input} disabled={busy || disabled} onChange={event => changeInput(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="mt-2 flex justify-end gap-2">{busy ? <Button onClick={() => cancel()}><CircleStop size={15} />取消</Button> : <Button primary disabled={!input.trim() || !settings.apiKey.trim() || loading || !!historyError || disabled || !online} onClick={() => void send()}><Send size={15} />发送</Button>}</div>
    </div>
  </section>;
}
