import { useEffect, useRef, useState } from 'react';
import type { Paper } from '../../modules/paper/model';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { askPaper } from '../../app/composition';
import { Button, inputClass, errorMessage } from '../controls';

export function PaperAssistant({
  paper,
  documentId,
  pageNumber,
  settings,
  figureId,
  panelId,
}: {
  paper: Paper;
  documentId?: string;
  pageNumber?: number;
  settings: ModelSettings;
  figureId?: string;
  panelId?: string;
}) {
  const questionInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => questionInput.current?.focus(), []);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const task = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => task.current?.abort(), []);
  async function send() {
    if (!question.trim() || busy) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError('');
    setAnswer('');
    const document = paper.documents.find((item) => item.id === documentId);
    setTarget(
      (document ? document.fileName + (pageNumber ? ` · 第 ${pageNumber} 页` : '') : '全部材料') +
        (figureId
          ? ' · ' +
            (paper.figures.find((figure) => figure.id === figureId)?.label ?? '当前图') +
            (panelId
              ? ' · Panel ' +
                (paper.figures
                  .flatMap((figure) => figure.regions.flatMap((region) => region.panels))
                  .find((panel) => panel.id === panelId)?.label ?? '')
              : '')
          : ''),
    );
    try {
      const result = await askPaper({
        paper,
        figureId,
        panelId,
        documentId,
        pageNumber,
        settings,
        question,
        signal: controller.signal,
        onText: setAnswer,
      });
      if (!controller.signal.aborted) setAnswer(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (task.current === controller) {
        task.current = undefined;
        setBusy(false);
      }
    }
  }
  return (
    <section className="border-t border-line p-4">
      <h2 className="text-sm font-medium">AI 只读问答</h2>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted">解释论文内容与已保存进度，图源选择使用页面控件。</p>
        <textarea
          ref={questionInput}
          aria-label="论文问题"
          className={`${inputClass} min-h-24`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className="flex gap-2">
          <Button primary disabled={busy || !question.trim() || !settings.apiKey} onClick={() => void send()}>
            发送问题
          </Button>
          {busy && (
            <Button
              onClick={() => {
                task.current?.abort();
                setBusy(false);
              }}
            >
              取消问答
            </Button>
          )}
        </div>
        {target && <p className="text-xs text-muted">本次范围：{target}</p>}
        {answer && <p className="whitespace-pre-wrap text-sm leading-6">{answer}</p>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
