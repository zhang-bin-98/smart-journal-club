import type { DeckPlan, PlannedSlide } from '../outline.schema';
import type { NarrativeIssue } from '../narrativeRules';
import type { Paper } from '../../paper/paper.schema';
import { figureSource } from '../../paper/sources';

export type OutlineIssueFocus = OutlineGuidance & { issue: NarrativeIssue; sequence: number };
export type OutlineField =
  | 'section'
  | 'title'
  | 'kind'
  | 'purpose'
  | 'message'
  | 'figures'
  | 'claims'
  | 'sources'
  | 'budget'
  | 'transitionToNext';
export type OutlineGuidance = { location: string; hint: string; targetId?: string; field: OutlineField };

export function outlineIssueKey(issue: NarrativeIssue) {
  return [issue.code, issue.sectionId, issue.slideId, issue.claimId, issue.figureId, issue.panelId, issue.message].join(
    '|',
  );
}

const instructions: Record<string, { field: OutlineField; hint: string }> = {
  'question-required': {
    field: 'kind',
    hint: '若已有讲研究问题的页面，点左侧页码，将“页面职责”改为“研究问题”并保存；若缺少页面，可在这里添加研究问题章节，再添加页面、填写问题和页数预算。',
  },
  'figure-source-mismatch': {
    field: 'figures',
    hint: '图已选中，但页面没有登记对应来源。点击“补全本页图源引用”，核对后保存草稿；不会换图或修改原始图源。',
  },
  'focus-underallocated': {
    field: 'claims',
    hint: '在“Claim 与讲述重点”核对这条结论。确需展开可在至少两张结果页勾选它；无需展开可改为“简略讲”。也可保留重点，在核对警告后继续确认，不必为凑数新增空页。',
  },
  'result-claim-required': {
    field: 'claims',
    hint: '在“Claim 与讲述重点”勾选本页实际支持的结论，然后保存；纯过渡页应将页面职责改为“过渡”。',
  },
  'result-purpose-required': { field: 'purpose', hint: '填写“页面目的”：说明这张结果页要解释什么，再保存草稿。' },
  'content-message-required': { field: 'message', hint: '填写“本页结论”：写出听众应带走的要点，然后保存草稿。' },
  'claim-evidence-source-mismatch': {
    field: 'claims',
    hint: '核对本页已选结论及其证据来源；重新勾选正确结论可补入对应来源，然后保存。',
  },
  'budget-mismatch': {
    field: 'budget',
    hint: '修改章节“页数预算”使其与实际页面数一致，或按讲述需要增删页面；修改预算不会自动生成页面。',
  },
  'unknown-figure': { field: 'figures', hint: '在 Figure / Panel 区核对引用，改选当前论文已有图源并保存。' },
  'unknown-panel': { field: 'figures', hint: '核对 Figure / Panel 选择，改选该 Figure 下有效的子图并保存。' },
  'invalid-layout-figure-count': {
    field: 'figures',
    hint: '核对所选图数与“布局”：单图、双图或子图网格；必要时拆页，不要删除必要证据来凑容量。',
  },
  'background-required': {
    field: 'section',
    hint: '在首个结果之前补充背景页面或背景章节；新增后填写内容，并核对章节预算。',
  },
  'study-design-required': {
    field: 'section',
    hint: '在首个结果之前补充研究设计章节，或将承担设计说明的页面职责设为“研究设计”。',
  },
  'results-required': { field: 'section', hint: '添加主要结果章节和结果页，填写页面目的、结论并勾选实际证据。' },
  'ending-required': {
    field: 'section',
    hint: '将综合或 Take-home 章节放在最后；可以在左侧新增章节，再用章节上下移动按钮调整位置。',
  },
  'opening-required': { field: 'section', hint: '第一章应为开场，第一页应为封面；核对章节顺序与第一页的页面职责。' },
  'results-light': {
    field: 'section',
    hint: '这是整套大纲的页数比例提醒，没有单独的出错页。可核对左侧结果页是否充分、背景是否能合并；讲述需要当前结构时，可以核对警告后继续确认，不必为凑比例加空页。',
  },
  'background-heavy': {
    field: 'section',
    hint: '这是背景页占比提醒。核对左侧背景页面是否有重复内容，必要时手工合并或删减；确有必要保留时，可以核对警告后继续确认。',
  },
  'transition-missing': {
    field: 'transitionToNext',
    hint: '在章节“过渡到下一章”填写一句衔接说明，然后保存草稿；也可核对后接受这条提醒。',
  },
  'generic-result-title': {
    field: 'title',
    hint: '将“页面标题”改成这页的具体研究结论，而不是“结果”或 Figure 编号，再保存草稿。',
  },
  'duplicate-message': {
    field: 'message',
    hint: '核对“本页结论”是否与其他页重复，按本页实际职责修改后保存；若重复有讲述需要，可以核对警告后保留。',
  },
};

/** 将校验位置解释为用户可识别的章节、页、图和结论；全局缺项不假装属于第一页。 */
export function outlineIssueGuidance(issue: NarrativeIssue, plan: DeckPlan, paper: Paper): OutlineGuidance {
  const slide = plan.slides.find((item) => item.id === issue.slideId);
  const section = plan.sections.find((item) => item.id === (slide?.sectionId ?? issue.sectionId));
  const claim = paper.claims.find((item) => item.id === issue.claimId);
  const claimPages = claim
    ? plan.slides.filter((item) => item.kind === 'result' && item.claimIds.includes(claim.id))
    : [];
  const claimTarget = claimPages[0] ?? plan.slides.find((item) => item.kind === 'result') ?? plan.slides[0];
  let location = '全局结构';
  if (slide) location = `第 ${plan.slides.indexOf(slide) + 1} 页 · ${slide.title || '未命名页面'}`;
  else if (section) location = `章节：${section.title || '未命名章节'}`;
  else if (claim) {
    const pages = claimPages.map((item) => plan.slides.indexOf(item) + 1).join('、');
    const coverage = pages ? `结果第 ${pages} 页` : '尚未分配结果页';
    location = `结论：${claim.text}（${coverage}）`;
  }
  if (issue.code === 'question-required') location = '全局结构 · 首个结果之前缺少研究问题';
  const figure = paper.figures.find((item) => item.id === issue.figureId);
  const panel = figure?.panels.find((item) => item.id === issue.panelId);
  if (figure) {
    const source = paper.sources.find((item) => item.id === (panel?.sourceId ?? figure.sourceId));
    location += ` · ${figure.label || 'Figure'}`;
    if (panel) location += ` / Panel ${panel.label || ''}`;
    if (source) location += `（原文第 ${source.pageNumber} 页）`;
  }
  const guide = instructions[issue.code] ?? {
    field: claim ? 'claims' : 'section',
    hint: '查看定位到的页面或章节，按提示修改对应内容并保存草稿；保存后问题列表会重新检查。',
  };
  return { location, ...guide, targetId: slide?.id ?? section?.id ?? (claim ? claimTarget?.id : undefined) };
}

/** 只补入当前页面已选且可解析的图源，不猜测未知 Figure/Panel，不移除其他来源。 */
export function missingFigureSourceIds(slide: PlannedSlide, paper: Paper): string[] {
  return [
    ...new Set(
      slide.figures.flatMap((selection) => {
        try {
          const source = figureSource(paper, selection);
          return slide.sourceIds.includes(source.id) ? [] : [source.id];
        } catch {
          return [];
        }
      }),
    ),
  ];
}

/** 新研究问题章插入首个结果所在章节之前，不挪动已有页面或隐式调整预算。 */
export function beforeResultsSection(plan: DeckPlan): string | null {
  const first = plan.slides.find(
    (slide) =>
      slide.kind === 'result' || plan.sections.find((section) => section.id === slide.sectionId)?.kind === 'results',
  );
  const index = plan.sections.findIndex((section) => section.id === first?.sectionId);
  return index < 0 ? (plan.sections.at(-1)?.id ?? null) : (plan.sections[index - 1]?.id ?? null);
}
