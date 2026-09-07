import type { DeckPlan } from '../outline.schema';
import type { NarrativeIssue, NarrativeValidation } from '../narrativeRules';
import type { Paper } from '../../paper/paper.schema';
import { outlineIssueGuidance, outlineIssueKey } from './issueGuidance';

export function OutlineIssues({
  issues,
  plan,
  paper,
  blocked,
  dirty,
  onLocate,
}: {
  issues: NarrativeValidation;
  plan: DeckPlan;
  paper: Paper;
  blocked: boolean;
  dirty: boolean;
  onLocate: (issue: NarrativeIssue) => void;
}) {
  return (
    <section aria-label="大纲检查与修改" className="mt-5 rounded border border-line bg-white p-4">
      <h3 className="text-sm font-semibold">
        需要修改 {issues.errors.length} 项 · 提醒 {issues.warnings.length} 项
      </h3>
      <p className="mt-1 text-xs text-muted">
        红色问题会阻止确认；橙色提醒可核对后接受。点击“定位修改”查看相关部分和修改说明。
      </p>
      {dirty && (
        <p role="status" className="mt-2 text-sm text-amber-700">
          当前有未保存输入。请先在编辑区保存草稿或取消修改，再定位其他问题。
        </p>
      )}
      {!issues.errors.length && !issues.warnings.length && (
        <p className="mt-2 text-sm text-success">当前大纲检查通过，可以确认。</p>
      )}
      <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto md:grid-cols-2">
        {[
          ...new Map([...issues.errors, ...issues.warnings].map((issue) => [outlineIssueKey(issue), issue])).values(),
        ].map((issue) => {
          const guide = outlineIssueGuidance(issue, plan, paper);
          return (
            <li key={outlineIssueKey(issue)} className="rounded border border-line p-3 text-sm">
              <p className="break-words font-medium">{guide.location}</p>
              <p className={`mt-1 ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                {issue.severity === 'error' ? '需修改：' : '提醒：'}
                {issue.message}
              </p>
              <button
                type="button"
                disabled={blocked}
                aria-label={`定位修改：${guide.location} · ${issue.message}`}
                onClick={() => onLocate(issue)}
                className="mt-2 text-accent underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                定位修改 →
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
