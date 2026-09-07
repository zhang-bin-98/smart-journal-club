import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import { Button, IconButton, inputClass } from '../../../ui/controls';
import { setDirty, type RegisterLeaveGuard } from '../../../app/activity';
import { SectionKinds, type SectionKind } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { DeckPlan, PlanMutation, PlannedSection } from '../outline.schema';
import { OutlineSlideForm } from './OutlineSlideForm';
import { beforeResultsSection, type OutlineIssueFocus } from './issueGuidance';

export type OutlineEdit = (mutations: PlanMutation[] | 'undo' | 'redo') => Promise<boolean>;
export const sectionLabels: Record<SectionKind, string> = {
  opening: '开场',
  background: '背景与空白',
  question: '研究问题',
  'study-design': '研究设计',
  results: '主要结果',
  synthesis: '综合',
  limitations: '局限',
  takeaways: 'Take-home',
  discussion: '讨论',
  custom: '过渡',
};

export function OutlineEditor({
  plan,
  paper,
  disabled,
  edit,
  canUndo,
  canRedo,
  onDirty,
  registerLeave,
  onSource,
  focus,
}: {
  plan: DeckPlan;
  paper: Paper;
  disabled: boolean;
  edit: OutlineEdit;
  canUndo: boolean;
  canRedo: boolean;
  onDirty: (dirty: boolean) => void;
  registerLeave: RegisterLeaveGuard;
  onSource: (sourceId: string) => void;
  focus?: OutlineIssueFocus;
}) {
  const [selected, select] = useState(plan.sections[0]?.id ?? '');
  const [dirty, changeDirty] = useState(false);
  const [newKind, setNewKind] = useState<SectionKind>('custom');
  const editorRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const section = plan.sections.find((item) => item.id === selected);
  const slide = plan.slides.find((item) => item.id === selected);
  const currentSection = section ?? plan.sections.find((item) => item.id === slide?.sectionId);
  const key = `outline-input-${plan.id}`;
  useEffect(() => {
    onDirty(dirty);
    setDirty(key, dirty);
    registerLeave(async () => {
      if (dirty) throw new Error('大纲有未保存输入，请先保存草稿或取消修改。');
    });
    return () => {
      registerLeave();
      setDirty(key, false);
    };
  }, [dirty, key, onDirty, registerLeave]);
  useEffect(() => {
    if (focus) select(focus.targetId ?? '');
  }, [focus]);
  useEffect(() => {
    const item = [
      ...(navRef.current?.querySelectorAll<HTMLElement>('[data-outline-slide], [data-outline-section]') ?? []),
    ].find((node) => (node.dataset.outlineSlide ?? node.dataset.outlineSection) === selected);
    item?.scrollIntoView({ block: 'nearest' });
    if (!focus || selected !== (focus.targetId ?? '')) return;
    const root = editorRef.current;
    const located = [
      ...(root?.querySelectorAll<HTMLElement>('[data-outline-claim], [data-outline-figure]') ?? []),
    ].find((node) =>
      focus.issue.claimId
        ? node.dataset.outlineClaim === focus.issue.claimId
        : !!focus.issue.figureId &&
          node.dataset.outlineFigure === focus.issue.figureId &&
          (node.dataset.outlinePanel || undefined) === focus.issue.panelId,
    );
    const field = root?.querySelector<HTMLElement>(`[data-outline-field="${focus.field}"]`);
    const target = located ?? field ?? root;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [selected, focus]);
  const blocked = disabled || dirty;
  const questionAnchor = beforeResultsSection(plan);
  const questionBoundary = questionAnchor ? plan.sections.findIndex((item) => item.id === questionAnchor) : -1;
  const existingQuestion = plan.sections.find((item, index) => item.kind === 'question' && index <= questionBoundary);
  async function addSection() {
    const id = crypto.randomUUID();
    const saved = await edit([
      {
        type: 'add-section',
        section: { id, kind: newKind, title: sectionLabels[newKind], purpose: '', slideBudget: 0 },
        afterSectionId: currentSection?.id ?? plan.sections.at(-1)?.id ?? null,
      },
    ]);
    if (saved) select(id);
  }
  async function addSlide() {
    if (!currentSection) return;
    const id = crypto.randomUUID();
    const saved = await edit([
      {
        type: 'add-slide',
        slide: {
          id,
          sectionId: currentSection.id,
          title: '新页面',
          purpose: '',
          message: '',
          kind:
            currentSection.kind === 'results' ? 'result' : currentSection.kind === 'question' ? 'question' : 'custom',
          layoutId: 'text-only',
          claimIds: [],
          sourceIds: [],
          figures: [],
        },
        afterSlideId:
          slide?.id ?? plan.slides.filter((item) => item.sectionId === currentSection.id).at(-1)?.id ?? null,
      },
    ]);
    if (saved) select(id);
  }
  async function addQuestionSection() {
    if (existingQuestion) {
      select(existingQuestion.id);
      return;
    }
    const id = crypto.randomUUID();
    if (
      await edit([
        {
          type: 'add-section',
          section: { id, kind: 'question', title: '研究问题', purpose: '', slideBudget: 0 },
          afterSectionId: questionAnchor,
        },
      ])
    )
      select(id);
  }
  return (
    <div className="mt-6 border-y border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
        <IconButton label="撤销大纲" disabled={blocked || !canUndo} onClick={() => void edit('undo')}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="重做大纲" disabled={blocked || !canRedo} onClick={() => void edit('redo')}>
          <Redo2 size={16} />
        </IconButton>
        <span role="status" className={`text-xs ${dirty ? 'text-amber-700' : 'text-success'}`}>
          {dirty ? '未保存' : '已保存'}
        </span>
        <span className="ml-auto text-xs text-muted">
          {plan.slides.length} 页 · 结果 {plan.slides.filter((item) => item.kind === 'result').length} 页
        </span>
      </div>
      <div className="grid min-w-0 md:grid-cols-[230px_minmax(0,1fr)]">
        <nav
          ref={navRef}
          aria-label="大纲章节与页面"
          className="max-h-[540px] overflow-y-auto border-b border-line py-3 md:border-r md:border-b-0 md:pr-3"
        >
          {plan.sections.map((item) => {
            const pages = plan.slides.filter((page) => page.sectionId === item.id);
            return (
              <div key={item.id} className="mb-2">
                <button
                  type="button"
                  data-outline-section={item.id}
                  aria-current={selected === item.id ? 'true' : undefined}
                  disabled={blocked}
                  onClick={() => select(item.id)}
                  className={`w-full rounded px-2 py-2 text-left text-sm ${selected === item.id ? 'bg-accent/10 text-accent' : ''}`}
                >
                  <strong className="block break-words">{item.title || '未命名章节'}</strong>
                  <span className={pages.length !== item.slideBudget ? 'text-amber-700' : 'text-muted'}>
                    实际 {pages.length} / 预算 {item.slideBudget} 页
                    {pages.length !== item.slideBudget ? ` · 差额 ${pages.length - item.slideBudget}` : ''}
                  </span>
                </button>
                {pages.map((page) => (
                  <button
                    type="button"
                    data-outline-slide={page.id}
                    aria-current={selected === page.id ? 'page' : undefined}
                    key={page.id}
                    disabled={blocked}
                    onClick={() => select(page.id)}
                    className={`block w-full rounded px-3 py-2 text-left text-xs break-words ${selected === page.id ? 'bg-accent/10 text-accent' : 'text-muted'}`}
                  >
                    {plan.slides.indexOf(page) + 1}. {page.title || '未命名页面'}
                  </button>
                ))}
              </div>
            );
          })}
          <div className="mt-4 flex items-center gap-2">
            <select
              aria-label="新增章节类型"
              className={inputClass}
              value={newKind}
              disabled={blocked}
              onChange={(event) => setNewKind(event.target.value as SectionKind)}
            >
              {SectionKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {sectionLabels[kind]}
                </option>
              ))}
            </select>
            <IconButton label="添加章节" disabled={blocked} onClick={() => void addSection()}>
              <Plus size={16} />
            </IconButton>
          </div>
        </nav>
        <div
          ref={editorRef}
          role="region"
          aria-label="大纲编辑区"
          tabIndex={-1}
          className="min-w-0 scroll-mt-6 py-5 outline-none md:pl-5"
        >
          <h3 className="mb-3 text-sm font-semibold">
            {slide
              ? `正在编辑：第 ${plan.slides.indexOf(slide) + 1} 页 · ${slide.title || '未命名页面'}`
              : section
                ? `正在编辑章节：${section.title || '未命名章节'}`
                : '选择要修改的章节或页面'}
          </h3>
          {focus && (!focus.targetId || focus.targetId === selected) && (
            <aside
              aria-label="当前问题修改说明"
              className="mb-4 rounded border border-accent/30 bg-accent/5 p-3 text-sm"
            >
              <p className="font-medium">{focus.issue.message}</p>
              <p className="mt-2">{focus.hint}</p>
              {focus.issue.code === 'question-required' && (
                <Button disabled={blocked} onClick={() => void addQuestionSection()} className="mt-3">
                  {existingQuestion ? '编辑已有研究问题章节' : '在结果前添加研究问题章节'}
                </Button>
              )}
            </aside>
          )}
          {section && (
            <SectionForm
              key={`${plan.id}-${plan.revision}-${section.id}`}
              section={section}
              plan={plan}
              disabled={disabled}
              edit={edit}
              onDirty={changeDirty}
            />
          )}
          {slide && (
            <OutlineSlideForm
              key={`${plan.id}-${plan.revision}-${slide.id}`}
              slide={slide}
              plan={plan}
              paper={paper}
              disabled={disabled}
              edit={edit}
              onDirty={changeDirty}
              onSource={onSource}
              focus={focus?.targetId === slide.id ? focus : undefined}
            />
          )}
          {!section && !slide && <p className="text-sm text-muted">请选择章节或页面</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={blocked || !currentSection} onClick={() => void addSlide()}>
              <FilePlus size={15} />
              添加页面
            </Button>
            <IconButton
              label={section ? '删除空章节' : '删除大纲页'}
              disabled={
                blocked ||
                (!section && !slide) ||
                !!(section && plan.slides.some((item) => item.sectionId === section.id))
              }
              onClick={() => {
                const mutation: PlanMutation = section
                  ? { type: 'delete-section', sectionId: section.id }
                  : { type: 'delete-slide', slideId: slide!.id };
                void edit([mutation]).then((saved) => {
                  if (saved) select('');
                });
              }}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionForm({
  section,
  plan,
  disabled,
  edit,
  onDirty,
}: {
  section: PlannedSection;
  plan: DeckPlan;
  disabled: boolean;
  edit: OutlineEdit;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(section);
  const [budget, setBudget] = useState(String(section.slideBudget));
  const dirty = JSON.stringify(draft) !== JSON.stringify(section) || budget !== String(section.slideBudget);
  const index = plan.sections.findIndex((item) => item.id === section.id);
  function change(next: PlannedSection, nextBudget = budget) {
    setDraft(next);
    setBudget(nextBudget);
    onDirty(JSON.stringify(next) !== JSON.stringify(section) || nextBudget !== String(section.slideBudget));
  }
  async function save() {
    const saved = await edit([
      {
        type: 'update-section',
        sectionId: section.id,
        patch: { title: draft.title, purpose: draft.purpose, transitionToNext: draft.transitionToNext ?? '' },
      },
      { type: 'set-slide-budget', sectionId: section.id, slideBudget: Number(budget) },
    ]);
    if (saved) onDirty(false);
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white py-3">
        <Button type="submit" disabled={disabled || !dirty}>
          <Save size={15} /> 保存草稿
        </Button>
        <Button disabled={disabled || !dirty} onClick={() => change(section, String(section.slideBudget))}>
          <X size={15} /> 取消章节修改
        </Button>
        <span className="text-xs text-muted">{dirty ? '有未保存修改' : '编辑章节后在这里保存'}</span>
      </div>
      <h3 className="text-sm font-semibold">{sectionLabels[section.kind]}</h3>
      <p className="text-xs text-muted">
        章节编辑用于组织标题、目的和页数。要修改页面内容，请点左侧带页码的页面；本章还没有页面时，点击下方“添加页面”。
      </p>
      {(['title', 'purpose', 'transitionToNext'] as const).map((field) => (
        <label key={field} className="block text-sm">
          {{ title: '章节标题', purpose: '章节目的', transitionToNext: '过渡到下一章' }[field]}
          <input
            data-outline-field={field}
            className={`${inputClass} mt-2`}
            value={draft[field] ?? ''}
            disabled={disabled}
            onChange={(event) => change({ ...draft, [field]: event.target.value })}
          />
        </label>
      ))}
      <label className="block text-sm">
        页数预算
        <input
          data-outline-field="budget"
          className={`${inputClass} mt-2`}
          type="number"
          min={0}
          step={1}
          required
          value={budget}
          disabled={disabled}
          onChange={(event) => change(draft, event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <IconButton
          label="上移章节"
          disabled={disabled || dirty || index < 1}
          onClick={() =>
            void edit([
              { type: 'move-section', sectionId: section.id, afterSectionId: plan.sections[index - 2]?.id ?? null },
            ])
          }
        >
          <ArrowUp size={16} />
        </IconButton>
        <IconButton
          label="下移章节"
          disabled={disabled || dirty || index === plan.sections.length - 1}
          onClick={() =>
            void edit([{ type: 'move-section', sectionId: section.id, afterSectionId: plan.sections[index + 1].id }])
          }
        >
          <ArrowDown size={16} />
        </IconButton>
      </div>
    </form>
  );
}
