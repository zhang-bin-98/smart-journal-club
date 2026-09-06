import { useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Save, X } from 'lucide-react';
import { Button, IconButton, inputClass } from '../../../ui/controls';
import { LayoutIds, SlideKinds } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { DeckPlan, PlannedSlide, PlanMutation, ClaimEmphasisEntry } from '../outline.schema';
import type { OutlineEdit } from './OutlineEditor';

const kinds = {
  title: '封面',
  background: '背景',
  question: '研究问题',
  method: '研究设计',
  result: '结果',
  summary: '综合',
  discussion: '讨论',
  conclusion: 'Take-home',
  custom: '过渡',
};
const layouts = {
  title: '封面',
  'text-only': '文字',
  'figure-full': '单图',
  'figure-text': '图文',
  'two-figures': '双图',
  'panel-grid': '子图网格',
};

export function OutlineSlideForm({
  slide,
  plan,
  paper,
  disabled,
  edit,
  onDirty,
  onSource,
}: {
  slide: PlannedSlide;
  plan: DeckPlan;
  paper: Paper;
  disabled: boolean;
  edit: OutlineEdit;
  onDirty: (dirty: boolean) => void;
  onSource: (sourceId: string) => void;
}) {
  const [draft, setDraft] = useState(slide);
  const [emphasis, setEmphasis] = useState(plan.claimEmphasis);
  const [target, setTarget] = useState(slide.sectionId);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(slide) || JSON.stringify(emphasis) !== JSON.stringify(plan.claimEmphasis);
  const pages = plan.slides.filter((item) => item.sectionId === slide.sectionId);
  const index = pages.findIndex((item) => item.id === slide.id);
  function change(next: PlannedSlide, nextEmphasis = emphasis) {
    setDraft(next);
    setEmphasis(nextEmphasis);
    onDirty(
      JSON.stringify(next) !== JSON.stringify(slide) ||
        JSON.stringify(nextEmphasis) !== JSON.stringify(plan.claimEmphasis),
    );
  }
  async function save() {
    const { id, sectionId, ...patch } = draft;
    const mutations: PlanMutation[] = [{ type: 'update-slide', slideId: id, patch }];
    for (const claim of paper.claims) {
      const before = plan.claimEmphasis.find((entry) => entry.claimId === claim.id)?.emphasis ?? null;
      const after = emphasis.find((entry) => entry.claimId === claim.id)?.emphasis ?? null;
      if (before !== after) mutations.push({ type: 'set-claim-emphasis', claimId: claim.id, emphasis: after });
    }
    if (await edit(mutations)) onDirty(false);
  }
  const figures: { selection: { figureId: string; panelId?: string }; label: string; sourceId: string }[] =
    paper.figures.flatMap((figure) => [
      { selection: { figureId: figure.id }, label: figure.label ?? '完整图', sourceId: figure.sourceId },
      ...figure.panels.map((panel) => ({
        selection: { figureId: figure.id, panelId: panel.id },
        label: `${figure.label ?? 'Figure'} ${panel.label ?? 'Panel'}`,
        sourceId: panel.sourceId,
      })),
    ]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      {(['title', 'purpose', 'message'] as const).map((field) => (
        <label key={field} className="block text-sm">
          {{ title: '页面标题', purpose: '页面目的', message: '本页结论' }[field]}
          <textarea
            className={`${inputClass} mt-2 min-h-16`}
            value={draft[field]}
            disabled={disabled}
            onChange={(event) => change({ ...draft, [field]: event.target.value })}
          />
        </label>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          页面职责
          <select
            className={`${inputClass} mt-2`}
            value={draft.kind}
            disabled={disabled}
            onChange={(event) => change({ ...draft, kind: event.target.value as PlannedSlide['kind'] })}
          >
            {SlideKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kinds[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          布局
          <select
            className={`${inputClass} mt-2`}
            value={draft.layoutId}
            disabled={disabled}
            onChange={(event) => change({ ...draft, layoutId: event.target.value as PlannedSlide['layoutId'] })}
          >
            {LayoutIds.map((layout) => (
              <option key={layout} value={layout}>
                {layouts[layout]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset disabled={disabled} className="space-y-3 border-t border-line pt-3">
        <legend className="text-sm font-medium">Claim 与讲述重点</legend>
        {paper.claims.map((claim) => {
          const value = emphasis.find((entry) => entry.claimId === claim.id)?.emphasis ?? 'brief';
          const referenced =
            draft.claimIds.includes(claim.id) ||
            plan.slides.some((item) => item.id !== slide.id && item.claimIds.includes(claim.id));
          return (
            <div key={claim.id} className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.claimIds.includes(claim.id)}
                  disabled={value === 'omit'}
                  onChange={(event) => {
                    const sourceIds = paper.evidences
                      .filter((evidence) => claim.evidenceIds.includes(evidence.id))
                      .flatMap((evidence) => evidence.sourceIds);
                    change({
                      ...draft,
                      claimIds: event.target.checked
                        ? [...draft.claimIds, claim.id]
                        : draft.claimIds.filter((id) => id !== claim.id),
                      sourceIds: event.target.checked
                        ? [...new Set([...draft.sourceIds, ...sourceIds])]
                        : draft.sourceIds,
                    });
                  }}
                />
                <span className="min-w-0 break-words">{claim.text}</span>
              </label>
              <select
                aria-label={`讲述重点：${claim.text}`}
                className={inputClass}
                value={value}
                onChange={(event) => {
                  const next: ClaimEmphasisEntry[] = emphasis.filter((entry) => entry.claimId !== claim.id);
                  if (event.target.value !== 'brief')
                    next.push({ claimId: claim.id, emphasis: event.target.value as 'focus' | 'omit' });
                  change(draft, next);
                }}
              >
                <option value="focus">重点讲</option>
                <option value="brief">简略讲</option>
                <option value="omit" disabled={referenced}>
                  不讲{referenced ? '（仍有页面引用）' : ''}
                </option>
              </select>
            </div>
          );
        })}
      </fieldset>
      <fieldset disabled={disabled} className="space-y-2 border-t border-line pt-3">
        <legend className="text-sm font-medium">Figure / Panel</legend>
        {!figures.length && <p className="text-sm text-muted">未识别到可用图源</p>}
        {figures.map((figure) => {
          const selected = draft.figures.some(
            (item) => item.figureId === figure.selection.figureId && item.panelId === figure.selection.panelId,
          );
          return (
            <div
              key={`${figure.selection.figureId}-${figure.selection.panelId ?? ''}`}
              className="flex items-center gap-2 text-sm"
            >
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) =>
                    change({
                      ...draft,
                      figures: event.target.checked
                        ? [...draft.figures, figure.selection]
                        : draft.figures.filter(
                            (item) =>
                              !(
                                item.figureId === figure.selection.figureId && item.panelId === figure.selection.panelId
                              ),
                          ),
                      sourceIds: event.target.checked
                        ? [...new Set([...draft.sourceIds, figure.sourceId])]
                        : draft.sourceIds,
                    })
                  }
                />
                <span className="break-words">{figure.label}</span>
              </label>
              <IconButton label={`查看来源：${figure.label}`} onClick={() => onSource(figure.sourceId)}>
                <FileText size={15} />
              </IconButton>
            </div>
          );
        })}
      </fieldset>
      <details className="border-t border-line pt-3 text-sm">
        <summary>原文来源（{draft.sourceIds.length}）</summary>
        <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
          {paper.sources.map((source) => (
            <label key={source.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                disabled={disabled}
                checked={draft.sourceIds.includes(source.id)}
                onChange={(event) =>
                  change({
                    ...draft,
                    sourceIds: event.target.checked
                      ? [...draft.sourceIds, source.id]
                      : draft.sourceIds.filter((id) => id !== source.id),
                  })
                }
              />
              <span className="min-w-0 break-words">
                第 {source.pageNumber} 页 · {source.textQuote?.slice(0, 100) || source.kind}
              </span>
            </label>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || !dirty}>
          <Save size={15} />
          保存草稿
        </Button>
        <IconButton
          label="取消页面修改"
          disabled={disabled || !dirty}
          onClick={() => change(slide, plan.claimEmphasis)}
        >
          <X size={16} />
        </IconButton>
        <IconButton
          label="上移大纲页"
          disabled={disabled || dirty || index < 1}
          onClick={() =>
            void edit([
              {
                type: 'move-slide',
                slideId: slide.id,
                targetSectionId: slide.sectionId,
                afterSlideId: pages[index - 2]?.id ?? null,
              },
            ])
          }
        >
          <ArrowUp size={16} />
        </IconButton>
        <IconButton
          label="下移大纲页"
          disabled={disabled || dirty || index === pages.length - 1}
          onClick={() =>
            void edit([
              {
                type: 'move-slide',
                slideId: slide.id,
                targetSectionId: slide.sectionId,
                afterSlideId: pages[index + 1].id,
              },
            ])
          }
        >
          <ArrowDown size={16} />
        </IconButton>
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          移动到章节
          <select
            className={`${inputClass} mt-2`}
            value={target}
            disabled={disabled || dirty}
            onChange={(event) => setTarget(event.target.value)}
          >
            {plan.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title || '未命名章节'}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={disabled || dirty || target === slide.sectionId}
          onClick={() =>
            void edit([
              {
                type: 'move-slide',
                slideId: slide.id,
                targetSectionId: target,
                afterSlideId: plan.slides.filter((item) => item.sectionId === target).at(-1)?.id ?? null,
              },
            ])
          }
        >
          移动
        </Button>
      </div>
    </form>
  );
}
