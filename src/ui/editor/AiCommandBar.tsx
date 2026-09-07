import { CircleStop, MessageCircle, Pencil, Send } from 'lucide-react';
import type { DeckSession } from '../../modules/deck/DeckSession';
import type { ModelSettings } from '../../shared/llm/model';
import { Button, inputClass } from '../controls';
import type { AssistantController } from './useAssistantController';

const scopes = [
  ['element', '选中元素'],
  ['slides', '当前页'],
  ['section', '当前章节'],
  ['deck', '整套 PPT'],
] as const;

export function AiCommandBar({
  controller,
  session,
  settings,
  selectedElementId,
  disabled = false,
}: {
  controller: AssistantController;
  session: DeckSession;
  settings: ModelSettings;
  selectedElementId?: string;
  disabled?: boolean;
}) {
  const {
    online,
    busy,
    loading,
    historyError,
    input,
    changeInput,
    send,
    cancel,
    mode,
    setMode,
    scope,
    setScope,
    proposal,
    target,
  } = controller;
  const actualScope =
    target.clarification ??
    `${target.global ? '整套 PPT' : target.sectionId ? '当前章节' : target.elementId ? '选中元素' : '页面'}：${
      target.slideIds.map((id) => session.current.slides.findIndex((slide) => slide.id === id) + 1).join('、') || '无'
    }`;
  return (
    <section aria-label="AI 命令区" className="border-x border-b border-line bg-panel px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="AI 作用范围" className="flex flex-wrap gap-1">
          {scopes.map(([value, label]) => (
            <Button
              key={value}
              aria-pressed={scope === value}
              disabled={busy || !!proposal || (value === 'element' && !selectedElementId)}
              onClick={() => setScope(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="AI 模式" className="ml-auto flex gap-1">
          <Button aria-pressed={mode === 'answer'} disabled={busy || !!proposal} onClick={() => setMode('answer')}>
            <MessageCircle size={14} />
            提问
          </Button>
          <Button aria-pressed={mode === 'revision'} disabled={busy || !!proposal} onClick={() => setMode('revision')}>
            <Pencil size={14} />
            修改
          </Button>
        </div>
      </div>
      <p aria-label="实际作用范围" className="mt-2 text-xs wrap-anywhere text-muted">
        实际范围：{actualScope}
      </p>
      {!online && <p className="mt-2 text-xs text-muted">当前离线，联网后可使用 AI；本地编辑和导出仍可用。</p>}
      {!settings.apiKey.trim() && <p className="mt-2 text-xs text-muted">请先通过顶栏的“模型设置”配置 Key。</p>}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          aria-label="AI 输入"
          className={`${inputClass} min-h-20 flex-1 resize-y`}
          placeholder="输入问题或修改要求；对话与提案会显示在右侧 AI 标签…"
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
    </section>
  );
}
