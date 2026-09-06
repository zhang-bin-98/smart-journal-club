import { AlertTriangle, Check, Download, XCircle } from 'lucide-react';
import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import { validateDeck } from '../../modules/deck/validateDeck';
import { validateDeckNarrative } from '../../modules/outline/validateNarrative';
import { Button } from '../controls';

export function CheckExport({
  deck,
  paper,
  resourceAvailable,
  exporting,
  onExport,
}: {
  deck: Deck;
  paper: Paper;
  resourceAvailable: boolean;
  exporting?: boolean;
  onExport: () => void;
}) {
  const structural = validateDeck(deck, paper);
  const narrative = validateDeckNarrative(deck, paper);
  const errors = [...structural.map((message) => ({ code: 'structure', message })), ...narrative.errors];
  const warnings = narrative.warnings;
  const hardBlocked = errors.length > 0 || !resourceAvailable || deck.slides.length === 0;
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-6" aria-label="检查与导出">
      <header className="border-b border-line pb-5">
        <h1 className="text-lg font-semibold">检查与导出</h1>
        <p className="mt-2 text-sm text-muted">
          {deck.slides.length} 页 · {errors.length} 个错误 · {warnings.length} 个警告
        </p>
      </header>
      <section className="mt-6 space-y-3" aria-label="检查结果">
        {!resourceAvailable && <Issue severity="error" message="原 PDF 缺失，无法确认图源。" />}
        {!deck.slides.length && <Issue severity="error" message="当前文稿没有幻灯片。" />}
        {errors.map((issue) => (
          <Issue key={`error-${issue.code}-${issue.message}`} severity="error" message={issue.message} />
        ))}
        {warnings.map((issue) => (
          <Issue key={`warning-${issue.code}-${issue.message}`} severity="warning" message={issue.message} />
        ))}
        {!errors.length && resourceAvailable && !!deck.slides.length && (
          <p className="flex items-center gap-2 text-sm text-success">
            <Check size={16} />
            硬性检查通过
          </p>
        )}
      </section>
      <div className="mt-8 flex justify-end">
        <Button primary disabled={hardBlocked || exporting} onClick={onExport}>
          <Download size={15} />
          {exporting ? '导出中…' : '导出 PPTX'}
        </Button>
      </div>
    </main>
  );
}
function Issue({ severity, message }: { severity: 'error' | 'warning'; message: string }) {
  return (
    <p className={`flex gap-2 text-sm ${severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
      <span aria-hidden="true">{severity === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}</span>
      {message}
    </p>
  );
}
