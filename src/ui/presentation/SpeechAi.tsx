import { useState } from 'react';
import { speechDiff, type SpeechScope } from '../../app/assistant/speechAssistant';
import type { SpeechController } from './useSpeechController';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { Button, inputClass } from '../controls';
export function SpeechAi({
  controller: c,
  selectedId,
  settings,
}: {
  controller: SpeechController;
  selectedId?: string;
  settings: ModelSettings;
}) {
  const [scope, setScope] = useState('paragraph');
  const [mode, setMode] = useState<'ask' | 'modify'>('ask');
  const [question, setQuestion] = useState('');
  const { answer, proposal, label, aiBusy: busy } = c;
  const target = c.state.data?.target;
  const content = target?.content;
  const paragraph = content?.speechParagraphs.find((p) => p.id === selectedId);
  async function send() {
    await c.act(async () => {
      if (!content || !question.trim()) return;
      const selected: SpeechScope =
        scope === 'all'
          ? { type: 'all' }
          : scope === 'section' && paragraph
            ? { type: 'section', id: paragraph.sectionId }
            : { type: 'paragraph', id: selectedId ?? '' };
      const name =
        selected.type === 'all'
          ? '全文'
          : selected.type === 'section'
            ? content.sections.find((s) => s.id === selected.id)?.title
            : paragraph?.purpose || '当前讲述';
      await c.send({ scope: selected, mode, question, settings, label: name ?? '' });
    });
  }
  return (
    <div className="flex max-h-[65vh] flex-col border-t border-line bg-white">
      <div className="flex shrink-0 items-center gap-2 p-3">
        <select
          aria-label="AI 操作模式"
          className={inputClass}
          value={mode}
          onChange={(e) => setMode(e.target.value as 'ask' | 'modify')}
        >
          <option value="ask">提问</option>
          <option value="modify">修改提案</option>
        </select>
        <select
          aria-label="AI 修改范围"
          className={inputClass}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="paragraph">当前讲述</option>
          <option value="section">当前章节</option>
          <option value="all">全文</option>
        </select>
      </div>
      <div className="min-h-0 overflow-y-auto px-3">
        {label && <p className="mb-2 text-xs text-muted">本次目标：{label}</p>}
        <p role="status" className="whitespace-pre-wrap text-sm leading-relaxed">
          {answer}
        </p>
        {proposal && (
          <div className="mt-3 rounded border border-accent p-3">
            <p className="font-medium">{proposal.summary}</p>
            {speechDiff(proposal.capture.target.content, proposal.preview, c.state.data?.paper).map((row) => (
              <div key={row.key} className="my-3 text-xs leading-relaxed">
                <p className="font-medium">{row.label}</p>
                <del className="block whitespace-pre-wrap text-muted">{row.before}</del>
                <p className="whitespace-pre-wrap text-accent">{row.after}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <Button primary onClick={() => void c.act(c.applyProposal)}>
                应用修改
              </Button>
              <Button onClick={() => c.setProposal(undefined)}>放弃提案</Button>
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-2 p-3">
        <textarea
          aria-label="AI 输入"
          className={inputClass}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="解释这段证据，或预览讲稿修改…"
        />
        <div className="flex gap-2">
          <Button
            primary
            disabled={busy || !target || !question.trim() || !settings.apiKey || c.running}
            onClick={() => void send()}
          >
            发送
          </Button>
          {busy && (
            <Button
              onClick={() => {
                c.cancelAi();
                c.setProposal(undefined);
              }}
            >
              取消请求
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
