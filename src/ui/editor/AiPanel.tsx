import { Bot, Check, CircleStop, Undo2, X } from 'lucide-react';
import type { Paper } from '../../modules/paper/paper.schema';
import { proposalDiff } from '../../modules/assistant/revision/proposalDiff';
import type { DeckSession } from '../../modules/deck/DeckSession';
import { Button } from '../controls';
import type { AssistantController } from './useAssistantController';

export function AiPanel({
  controller,
  session,
  paper,
  disabled = false,
}: {
  controller: AssistantController;
  session: DeckSession;
  paper: Paper;
  disabled?: boolean;
}) {
  const {
    messages,
    pendingMessage,
    busy,
    loading,
    historyError,
    setHistoryAttempt,
    error,
    notice,
    cancel,
    canUndo,
    undoRevision,
    messageList,
    proposal,
    apply,
    progress,
    streamedText,
  } = controller;
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-panel p-4" aria-label="AI 对话与提案">
      <div className="flex items-center gap-2">
        <Bot size={17} />
        <h2 className="text-sm font-semibold">AI 对话与提案</h2>
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
            <p>
              影响页：
              {proposal.affectedSlideIds
                .map((id) => {
                  const index = session.current.slides.findIndex((slide) => slide.id === id);
                  return index < 0 ? '新增或已删除页' : `第 ${index + 1} 页`;
                })
                .join('、')}
            </p>
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
    </section>
  );
}
