import { AlertTriangle, Check, Download, Eye, FileWarning, XCircle } from 'lucide-react';
import { useState } from 'react';
import {
  checkPresentation,
  locatePresentationIssue,
  type CheckLocation,
  type PresentationExportOptions,
  type PresentationIssue,
} from '../../app/presentation/checkPresentation';
import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import { Button } from '../controls';

export function CheckExport({
  deck,
  paper,
  resourceAvailable,
  exporting,
  onExport,
  onLocate,
}: {
  deck: Deck;
  paper: Paper;
  resourceAvailable: boolean;
  exporting?: boolean;
  onExport: (options?: PresentationExportOptions) => void;
  onLocate: (location: CheckLocation) => void;
}) {
  const check = checkPresentation(deck, paper, resourceAvailable);
  const [acceptedVersion, setAcceptedVersion] = useState<string>();
  const warningsAccepted = acceptedVersion === check.version;
  const blocked = check.errors.length > 0 || deck.slides.length === 0;
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-6" aria-label="检查与导出">
      <header className="border-b border-line pb-5">
        <h1 className="text-lg font-semibold">检查与导出</h1>
        <p className="mt-2 text-sm text-muted">
          {deck.slides.length} 页 · {deck.language} · {check.errors.length} 个错误 · {check.warnings.length} 个警告
        </p>
      </header>
      <CheckGroup title="错误" empty="没有阻止导出的错误。" issues={check.errors} deck={deck} onLocate={onLocate} />
      <CheckGroup title="警告" empty="没有需要确认的警告。" issues={check.warnings} deck={deck} onLocate={onLocate} />
      <section className="mt-6" aria-label="科学表达人工复核">
        <h2 className="text-sm font-semibold">待人工复核</h2>
        <div className="mt-3 space-y-2">
          {check.reviews.map((item) => (
            <p key={item.code} className="flex gap-2 text-sm text-muted">
              <Eye size={16} className="mt-0.5 shrink-0" />
              {item.message}
            </p>
          ))}
        </div>
      </section>
      <section className="mt-6 border-t border-line pt-4 text-sm" aria-label="资源状态">
        <h2 className="font-semibold">资源</h2>
        <p className={`mt-2 flex items-center gap-2 ${resourceAvailable ? 'text-success' : 'text-amber-700'}`}>
          {resourceAvailable ? <Check size={16} /> : <FileWarning size={16} />}
          {resourceAvailable
            ? `原 PDF 与当前引用可用于来源核对${check.hasFigures ? '和图像导出' : ''}。`
            : check.hasFigures
              ? '原 PDF 缺失，含图文稿不能导出。'
              : '原 PDF 缺失，来源查看不可用；纯文字文稿仍可导出。'}
        </p>
      </section>
      {!!check.warnings.length && !blocked && (
        <label className="mt-6 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={warningsAccepted}
            onChange={(event) => setAcceptedVersion(event.target.checked ? check.version : undefined)}
          />
          <span>我已查看当前已保存版本的警告，仍要导出。内容修改后需要重新检查和确认。</span>
        </label>
      )}
      <div className="mt-8 flex justify-end">
        <Button
          primary
          disabled={blocked || exporting || (!!check.warnings.length && !warningsAccepted)}
          onClick={() => onExport({ warningsAcceptedFor: warningsAccepted ? check.version : undefined })}
        >
          <Download size={15} />
          {exporting ? '导出中…' : check.warnings.length ? '确认警告并导出 PPTX' : '导出 PPTX'}
        </Button>
      </div>
    </main>
  );
}

function CheckGroup({
  title,
  empty,
  issues,
  deck,
  onLocate,
}: {
  title: string;
  empty: string;
  issues: PresentationIssue[];
  deck: Deck;
  onLocate: (location: CheckLocation) => void;
}) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">
        {issues.map((issue) => (
          <Issue
            key={`${issue.severity}-${issue.code}-${issue.slideId ?? issue.sectionId ?? 'global'}-${issue.elementId ?? ''}-${issue.message}`}
            issue={issue}
            location={locatePresentationIssue(deck, issue)}
            onLocate={onLocate}
          />
        ))}
        {!issues.length && <p className="text-sm text-success">{empty}</p>}
      </div>
    </section>
  );
}

function Issue({
  issue,
  location,
  onLocate,
}: {
  issue: PresentationIssue;
  location: CheckLocation;
  onLocate: (location: CheckLocation) => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded border p-3 text-sm ${
        issue.severity === 'error' ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-800'
      }`}
    >
      <span aria-hidden="true">{issue.severity === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}</span>
      <span className="min-w-0 flex-1">{issue.message}</span>
      {location.slideId && <Button onClick={() => onLocate(location)}>定位到编辑器</Button>}
    </div>
  );
}
