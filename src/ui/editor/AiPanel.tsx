import { Bot, Check, CircleStop, MessageCircle, Pencil, Send, Undo2, X } from 'lucide-react';
import type { ModelSettings } from '../../shared/llm/model';
import type { Paper } from '../../modules/paper/paper.schema';
import type { Project } from '../../modules/project/project.schema';
import type { PersistAssistantRevision } from '../../modules/assistant/revision/applyRevision';
import type { DeckSession } from '../../modules/deck/DeckSession';
import { Button, inputClass } from '../controls';
import { useAssistantController } from './useAssistantController';
import { proposalDiff } from '../../modules/assistant/revision/proposalDiff';

export type CancelAi = (reason?: 'manual') => boolean;
export function AiPanel({
  session,
  paper,
  settings,
  projectId,
  preferences,
  persistRevision,
  selectedSlideId,
  selectedElementId,
  onChanged,
  beforeSend,
  beforeUndo,
  onBusyChange,
  registerCancel,
  disabled = false,
}: {
  disabled?: boolean;
  session: DeckSession;
  paper: Paper;
  settings: ModelSettings;
  projectId?: string;
  preferences?: Project['preferences'];
  persistRevision?: PersistAssistantRevision;
  selectedSlideId?: string;
  selectedElementId?: string;
  onChanged: () => void;
  beforeSend: () => Promise<void>;
  beforeUndo: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  registerCancel: (cancel?: CancelAi) => void;
}) {
  const controller = useAssistantController({
    session,
    paper,
    settings,
    projectId,
    preferences,
    persistRevision,
    selectedSlideId,
    selectedElementId,
    onChanged,
    beforeSend,
    beforeUndo,
    onBusyChange,
    registerCancel,
    disabled,
  });
  const {
    online,
    messages,
    pendingMessage,
    busy,
    loading,
    historyError,
    setHistoryAttempt,
    error,
    notice,
    input,
    changeInput,
    send,
    cancel,
    canUndo,
    undoRevision,
    messageList,
    mode,
    setMode,
    scope,
    setScope,
    proposal,
    apply,
    progress,
    streamedText,
    target,
  } = controller;
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-panel p-4" aria-label="AI 助手">
      <div className="flex items-center gap-2">
        <Bot size={17} />
        <h2 className="text-sm font-semibold">AI 助手</h2>
      </div>
      <div
        ref={messageList}
        className="mt-3 min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain"
        aria-live="polite"
        aria-busy={busy || loading}
      >
        {loading && (
          <p role="status" className="text-xs text-muted">
            正在读取对话…
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`text-xs leading-relaxed ${message.role === 'user' ? 'border-l-2 border-accent pl-2' : 'border-l-2 border-line pl-2'}`}
          >
            <p className="mb-1 text-[11px] text-muted">{message.role === 'user' ? '你' : 'AI 助手'}</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>
            {message.summary && (
              <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-muted">修改摘要：{message.summary}</p>
            )}
            {!!message.affectedSlideIds?.length && (
              <p className="mt-1 text-muted">
                受影响页：
                {message.affectedSlideIds
                  .map((id) => {
                    const index = session.current.slides.findIndex((slide) => slide.id === id);
                    return index < 0 ? '已删除页' : `第 ${index + 1} 页`;
                  })
                  .join('、')}
              </p>
            )}
            {message.revision !== undefined && (
              <Button
                className="mt-2"
                disabled={!canUndo(message) || busy || disabled}
                onClick={() => void undoRevision(message)}
              >
                <Undo2 size={14} />
                撤销本次修改
              </Button>
            )}
          </div>
        ))}
        {pendingMessage && (
          <div className="border-l-2 border-accent pl-2 text-xs leading-relaxed">
            <p className="mb-1 text-[11px] text-muted">你</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{pendingMessage}</p>
          </div>
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted">
            <CircleStop size={14} className="animate-pulse" />
            {progress}
          </p>
        )}
        {busy && streamedText && <p className="whitespace-pre-wrap wrap-anywhere text-xs">{streamedText}</p>}
        {proposal && (
          <section aria-label="待应用修改" className="space-y-3 border-t border-line pt-3 text-xs">
            <h3 className="font-semibold">待应用修改</h3>
            <p className="wrap-anywhere">{proposal.summary}</p>
            <p>影响 {proposal.affectedSlideIds.length} 页</p>
            <details>
              <summary className="cursor-pointer">查看差异</summary>
              {proposal.affectedSlideIds.map((id) => {
                const before = session.current.slides.find((slide) => slide.id === id);
                const after = proposal.preview.slides.find((slide) => slide.id === id);
                const page = session.current.slides.findIndex((slide) => slide.id === id) + 1;
                return (
                  <div key={id} className="mt-3 space-y-2 border-l-2 border-line pl-2 wrap-anywhere">
                    <p className="font-medium">{page ? `第 ${page} 页` : '新增页'}</p>
                    {proposalDiff(before, after, paper, { before: session.current, after: proposal.preview }).map(
                      (row) => (
                        <div key={row.key}>
                          <p>{row.label}</p>
                          <p>修改前：{row.before}</p>
                          <p>修改后：{row.after}</p>
                        </div>
                      ),
                    )}
                  </div>
                );
              })}
            </details>
            <div className="flex flex-wrap gap-2">
              <Button primary disabled={busy || disabled} onClick={() => void apply()}>
                <Check size={14} />
                应用修改
              </Button>
              <Button disabled={busy} onClick={() => cancel()}>
                <X size={14} />
                放弃
              </Button>
            </div>
          </section>
        )}
      </div>
      {historyError && (
        <div role="alert" className="mt-3 text-xs text-red-700">
          <p>读取对话失败：{historyError}</p>
          <Button className="mt-2" onClick={() => setHistoryAttempt((value) => value + 1)}>
            重试读取
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-xs text-muted">
          {notice}
        </p>
      )}
      <div className="mt-4 shrink-0 border-t border-line pt-3">
        <div role="group" aria-label="AI 模式" className="mb-2 flex gap-1">
          <Button aria-pressed={mode === 'answer'} disabled={busy || !!proposal} onClick={() => setMode('answer')}>
            <MessageCircle size={14} />
            提问
          </Button>
          <Button aria-pressed={mode === 'revision'} disabled={busy || !!proposal} onClick={() => setMode('revision')}>
            <Pencil size={14} />
            修改
          </Button>
        </div>
        <label className="mb-2 flex items-center gap-2 text-xs">
          范围
          <select
            aria-label="AI 作用范围"
            className={inputClass}
            value={scope}
            disabled={busy || !!proposal}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="element" disabled={!selectedElementId}>
              元素
            </option>
            <option value="slides">页面</option>
            <option value="section">章节</option>
            <option value="deck">整套 PPT</option>
          </select>
        </label>
        <p aria-label="实际作用范围" className="mb-2 text-xs wrap-anywhere text-muted">
          {target.clarification ??
            `${target.global ? '整套 PPT' : target.sectionId ? '当前章节' : target.elementId ? '选定元素' : '页面'}：${target.slideIds.map((id) => session.current.slides.findIndex((slide) => slide.id === id) + 1).join('、') || '无'}`}
        </p>
        {!online && (
          <p role="status" className="mb-2 text-xs text-muted">
            当前离线，联网后可使用 AI；本地编辑和导出仍可用。
          </p>
        )}
        {!settings.apiKey.trim() && <p className="mb-2 text-xs text-muted">请先通过顶栏的“模型设置”配置 Key。</p>}
        <textarea
          aria-label="AI 输入"
          className={`${inputClass} min-h-24 max-h-48 resize-y`}
          placeholder="告诉我怎么调整…"
          value={input}
          disabled={busy || disabled}
          onChange={(event) => changeInput(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex justify-end gap-2">
          {busy ? (
            <Button onClick={() => cancel()}>
              <CircleStop size={15} />
              取消
            </Button>
          ) : (
            <Button
              primary
              disabled={!input.trim() || !settings.apiKey.trim() || loading || !!historyError || disabled || !online}
              onClick={() => void send()}
            >
              <Send size={15} />
              发送
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
