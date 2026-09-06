import type { Deck, LayoutId, SectionKind, SlideElement, SlideKind } from '../deck/deck.schema';
import { layoutCapacity } from '../deck/layoutRules';
import type { DeckPlan } from './outline.schema';
import type { Paper } from '../paper/paper.schema';

export interface NarrativeIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  sectionId?: string;
  slideId?: string;
  elementId?: string;
  claimId?: string;
  figureId?: string;
}
export interface NarrativeValidation {
  errors: NarrativeIssue[];
  warnings: NarrativeIssue[];
}
type IssueAt = Omit<NarrativeIssue, 'code' | 'severity' | 'message'>;
const issue = (code: string, severity: 'error' | 'warning', message: string, at: IssueAt = {}): NarrativeIssue => ({
  code,
  severity,
  message,
  ...at,
});
const hasText = (value: string | undefined) => !!(value ?? '').trim();
const normalizeText = (value: string | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export type NarrativeFigure = { figureId: string; panelId?: string };
export interface NarrativeSection {
  id: string;
  kind: SectionKind;
  title: string;
  purpose: string;
  transitionToNext?: string;
  slideBudget?: number;
}
export interface NarrativeSlide {
  id: string;
  sectionId: string;
  kind: SlideKind;
  title: string;
  purpose?: string;
  message?: string;
  layoutId: LayoutId;
  claimIds: string[];
  sourceIds: string[];
  figures: NarrativeFigure[];
}
export interface NarrativeView {
  sections: NarrativeSection[];
  slides: NarrativeSlide[];
}
/** Plan/Deck 共享的只读叙事视图：两个入口各自提取，规则只看本结构，不使用联合领域类型。 */
export function planNarrativeView(plan: DeckPlan): NarrativeView {
  return {
    sections: plan.sections.map(({ id, kind, title, purpose, transitionToNext, slideBudget }) => ({
      id,
      kind,
      title,
      purpose,
      transitionToNext,
      slideBudget,
    })),
    slides: plan.slides.map((slide) => ({ ...slide })),
  };
}
export function deckNarrativeView(deck: Deck): NarrativeView {
  return {
    sections: deck.sections.map(({ id, kind, title, purpose, transitionToNext }) => ({
      id,
      kind,
      title,
      purpose,
      transitionToNext,
    })),
    slides: deck.slides.map(({ elements, ...slide }) => ({
      ...slide,
      figures: elements.flatMap((element) =>
        element.type === 'figure' ? [{ figureId: element.figureId, panelId: element.panelId }] : [],
      ),
    })),
  };
}

/** 结构引用：章节/页面 ID 唯一、页面归属存在的章节且同章连续（与基础 validator 同一族不变量的可定位版本）。 */
export function structureIssues(view: NarrativeView): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const sectionIds = new Set<string>();
  for (const section of view.sections) {
    if (sectionIds.has(section.id))
      issues.push(issue('duplicate-id', 'error', `章节 ID 重复：${section.id}`, { sectionId: section.id }));
    sectionIds.add(section.id);
  }
  const slideIds = new Set<string>();
  for (const slide of view.slides) {
    if (slideIds.has(slide.id))
      issues.push(issue('duplicate-id', 'error', `页面 ID 重复：${slide.id}`, { slideId: slide.id }));
    slideIds.add(slide.id);
    if (!sectionIds.has(slide.sectionId))
      issues.push(
        issue('unknown-section', 'error', `页面引用不存在的章节：${slide.sectionId}`, {
          slideId: slide.id,
          sectionId: slide.sectionId,
        }),
      );
  }
  const blocks: string[] = [];
  let blockSectionId: string | undefined;
  for (const slide of view.slides) {
    if (slide.sectionId !== blockSectionId) {
      if (blocks.includes(slide.sectionId))
        issues.push(
          issue('noncontiguous-section-slides', 'error', `章节页面不连续：${slide.sectionId}`, {
            sectionId: slide.sectionId,
            slideId: slide.id,
          }),
        );
      blocks.push(slide.sectionId);
      blockSectionId = slide.sectionId;
    }
  }
  return issues;
}

/** 研究设计是否为论文事实：studyProfile.designSummary 或 story.studyDesign 任一非空即需要设计职责。 */
function paperNeedsDesign(paper: Paper): boolean {
  if (paper.studyProfile?.designSummary.trim()) return true;
  return (paper.story?.studyDesign ?? []).some((point) => point.text.trim() !== '');
}
function lastIndexOfKind(sections: NarrativeSection[], kinds: SectionKind[]) {
  let last = -1;
  sections.forEach((section, index) => {
    if (kinds.includes(section.kind)) last = index;
  });
  return last;
}
function lastMeaningfulSection(view: NarrativeView) {
  for (let index = view.sections.length - 1; index >= 0; index--)
    if (view.sections[index].kind !== 'custom') return view.sections[index];
  return undefined;
}

/** 学术骨架：开场、结果前职责、结果与收尾的确定性顺序规则；不做文本语义判断。 */
export function skeletonIssues(view: NarrativeView, paper: Paper): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  if (!view.slides.length) return issues;
  if (view.sections[0]?.kind !== 'opening' || view.slides[0].kind !== 'title')
    issues.push(
      issue('opening-required', 'error', '第一章必须是开场且第一页必须是标题页。', {
        sectionId: view.sections[0]?.id,
        slideId: view.slides[0].id,
      }),
    );
  const sectionKindOf = new Map(view.sections.map((section) => [section.id, section.kind]));
  const firstResultSlide = view.slides.findIndex(
    (slide) => slide.kind === 'result' || sectionKindOf.get(slide.sectionId) === 'results',
  );
  if (firstResultSlide >= 0) {
    const dutyBefore = (sectionKind: SectionKind, slideKind: SlideKind) =>
      view.slides.some(
        (slide, index) =>
          index < firstResultSlide && (slide.kind === slideKind || sectionKindOf.get(slide.sectionId) === sectionKind),
      );
    if (!dutyBefore('background', 'background'))
      issues.push(issue('background-required', 'error', '首个结果之前需要承担背景职责的章节或页面。'));
    if (!dutyBefore('question', 'question'))
      issues.push(issue('question-required', 'error', '首个结果之前需要明确的研究问题章节或页面。'));
    if (paperNeedsDesign(paper) && !dutyBefore('study-design', 'method'))
      issues.push(issue('study-design-required', 'error', '论文包含研究设计，首个结果之前需要设计章节或方法页。'));
  }
  const firstOpeningIndex = view.sections.findIndex((section) => section.kind === 'opening');
  const firstResultsSection = view.sections.findIndex((section) => section.kind === 'results');
  const lastEndingSection = lastIndexOfKind(view.sections, ['synthesis', 'takeaways']);
  view.sections.forEach((section, index) => {
    if (section.kind === 'opening' && firstOpeningIndex >= 0 && index !== firstOpeningIndex)
      issues.push(issue('invalid-section-order', 'error', '开场章节只能出现一次。', { sectionId: section.id }));
    if (
      ['opening', 'background', 'question', 'study-design'].includes(section.kind) &&
      firstResultsSection >= 0 &&
      index > firstResultsSection
    )
      issues.push(
        issue('invalid-section-order', 'error', '开场/背景/问题/设计章节不能出现在结果之后。', {
          sectionId: section.id,
        }),
      );
    if (section.kind === 'results' && lastEndingSection >= 0 && index > lastEndingSection)
      issues.push(
        issue('invalid-section-order', 'error', '最终综合或结论之后不能再出现结果章节。', { sectionId: section.id }),
      );
  });
  if (!view.sections.some((section) => section.kind === 'results') || firstResultSlide < 0)
    issues.push(issue('results-required', 'error', '至少需要一个 results 章节和一页 result 页面。'));
  const ending = lastMeaningfulSection(view);
  if (!ending || !['synthesis', 'takeaways'].includes(ending.kind))
    issues.push(issue('ending-required', 'error', '最后一个非自定义章节必须是综合或结论。', { sectionId: ending?.id }));
  return issues;
}

/** 内容职责：结果页 Claim/目的与内容页 take-home；仅按 kind 与字段判定，不推断文本质量。 */
export function contentIssues(view: NarrativeView, paper: Paper, planMode: boolean): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const claimIds = new Set(paper.claims.map((claim) => claim.id));
  for (const slide of view.slides) {
    if (slide.kind === 'result') {
      if (!slide.claimIds.some((id) => claimIds.has(id)))
        issues.push(
          issue('result-claim-required', 'error', '结果页必须至少引用一个有效结论。', {
            slideId: slide.id,
            sectionId: slide.sectionId,
          }),
        );
      if (planMode && !hasText(slide.purpose))
        issues.push(
          issue('result-purpose-required', 'error', '计划中的结果页需要填写页面目的。', {
            slideId: slide.id,
            sectionId: slide.sectionId,
          }),
        );
    }
    if (slide.kind !== 'title' && slide.kind !== 'custom' && !hasText(slide.message))
      issues.push(
        issue('content-message-required', 'error', '内容页需要本页结论（take-home）。', {
          slideId: slide.id,
          sectionId: slide.sectionId,
        }),
      );
  }
  return issues;
}

/** 引用与证据链：Claim/Source/Figure/Panel 属于当前 Paper，图源与证据来源落在页面来源中，布局容量复用 layoutRules。 */
export function referenceIssues(view: NarrativeView, paper: Paper): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const claims = new Map(paper.claims.map((claim) => [claim.id, claim]));
  const sourceIds = new Set(paper.sources.map((source) => source.id));
  for (const slide of view.slides) {
    for (const claimId of slide.claimIds)
      if (!claims.has(claimId))
        issues.push(issue('unknown-claim', 'error', `引用的结论不存在：${claimId}`, { slideId: slide.id, claimId }));
    for (const sourceId of slide.sourceIds)
      if (!sourceIds.has(sourceId))
        issues.push(issue('unknown-source', 'error', `引用的来源不存在：${sourceId}`, { slideId: slide.id }));
    slide.figures.forEach((figure) => {
      const ref = paper.figures.find((item) => item.id === figure.figureId);
      if (!ref) {
        issues.push(
          issue('unknown-figure', 'error', `引用的图不存在：${figure.figureId}`, {
            slideId: slide.id,
            figureId: figure.figureId,
          }),
        );
        return;
      }
      const panel = figure.panelId ? ref.panels.find((item) => item.id === figure.panelId) : undefined;
      if (figure.panelId && !panel) {
        issues.push(
          issue('unknown-panel', 'error', `引用的子图不存在：${figure.panelId}`, {
            slideId: slide.id,
            figureId: figure.figureId,
          }),
        );
        return;
      }
      const figureSourceId = panel ? panel.sourceId : ref.sourceId;
      if (!slide.sourceIds.includes(figureSourceId))
        issues.push(
          issue('figure-source-mismatch', 'error', '页面来源未包含该图的原始来源。', {
            slideId: slide.id,
            figureId: figure.figureId,
          }),
        );
    });
    if (slide.kind === 'result')
      for (const claimId of slide.claimIds) {
        const claim = claims.get(claimId);
        if (!claim) continue;
        const evidenceSources = paper.evidences
          .filter((evidence) => claim.evidenceIds.includes(evidence.id))
          .flatMap((evidence) => evidence.sourceIds);
        if (!evidenceSources.some((sourceId) => slide.sourceIds.includes(sourceId)))
          issues.push(
            issue('claim-evidence-source-mismatch', 'error', '结果页来源未覆盖所引结论的证据来源。', {
              slideId: slide.id,
              claimId,
            }),
          );
      }
    const elements: SlideElement[] = slide.figures.map((figure, index) => ({
      id: `${slide.id}-figure-${index}`,
      type: 'figure',
      figureId: figure.figureId,
      panelId: figure.panelId,
    }));
    if (!layoutCapacity({ layoutId: slide.layoutId, elements }))
      issues.push(issue('invalid-layout-figure-count', 'error', '布局无法容纳当前图源数量。', { slideId: slide.id }));
  }
  return issues;
}

/** 计划专属：confirmed 预算/空章、稀疏 claimEmphasis 的 omit 引用与 focus 页数提示；Deck 不持有这些偏好。 */
export function planOnlyIssues(view: NarrativeView, plan: DeckPlan, paper: Paper): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const confirmed = plan.status === 'confirmed';
  const claimIds = new Set(paper.claims.map((claim) => claim.id));
  view.sections.forEach((section) => {
    const actual = view.slides.filter((slide) => slide.sectionId === section.id).length;
    if (confirmed && section.slideBudget !== undefined && section.slideBudget !== actual)
      issues.push(
        issue('budget-mismatch', 'error', `章节预算与实际页数不一致：${section.title}`, { sectionId: section.id }),
      );
    if (confirmed && actual === 0)
      issues.push(
        issue('empty-confirmed-section', 'error', `已确认计划的章节至少需要一页：${section.title}`, {
          sectionId: section.id,
        }),
      );
  });
  const omitted = new Set(
    plan.claimEmphasis
      .filter((entry) => entry.emphasis === 'omit' && claimIds.has(entry.claimId))
      .map((entry) => entry.claimId),
  );
  for (const slide of view.slides)
    for (const claimId of slide.claimIds)
      if (omitted.has(claimId))
        issues.push(
          issue('omit-claim-referenced', 'error', '已标记不讲的结论仍被页面引用。', { slideId: slide.id, claimId }),
        );
  for (const entry of plan.claimEmphasis) {
    if (!claimIds.has(entry.claimId)) {
      issues.push(
        issue('unknown-claim', 'error', `重点设置引用的结论不存在：${entry.claimId}`, { claimId: entry.claimId }),
      );
      continue;
    }
    if (entry.emphasis === 'focus') {
      const resultPages = view.slides.filter(
        (slide) => slide.kind === 'result' && slide.claimIds.includes(entry.claimId),
      ).length;
      if (resultPages < 2)
        issues.push(
          issue('focus-underallocated', 'warning', '重点结论建议至少分配两页结果。', { claimId: entry.claimId }),
        );
    }
  }
  return issues;
}

const GENERIC_RESULT_TITLES = new Set(['', 'result', 'results', '结果', '主要结果', '研究发现', '主要发现']);
function isGenericResultTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return GENERIC_RESULT_TITLES.has(normalized) || /^(fig(\.|ure)?\s*\d+|图\s*\d+)$/.test(normalized);
}

/** 质量提醒：比例、缺失职责、过渡、宽泛标题与重复表达；全部为透明确定性条件，不阻止确认。 */
export function narrativeWarnings(view: NarrativeView): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const total = view.slides.length;
  if (total) {
    const backgroundCount = view.slides.filter((slide) => slide.kind === 'background').length;
    if (backgroundCount / total > 0.25)
      issues.push(issue('background-heavy', 'warning', '背景页超过总页数的四分之一。'));
    const resultCount = view.slides.filter((slide) => slide.kind === 'result').length;
    if (resultCount / total < 0.5) issues.push(issue('results-light', 'warning', '结果页少于总页数的一半。'));
  }
  if (!view.sections.some((section) => section.kind === 'limitations' || section.kind === 'discussion'))
    issues.push(issue('critical-discussion-missing', 'warning', '缺少局限或批判性讨论章节。'));
  view.sections.slice(0, -1).forEach((section) => {
    if (!hasText(section.transitionToNext))
      issues.push(
        issue('transition-missing', 'warning', `章节缺少向下一章的过渡：${section.title}`, { sectionId: section.id }),
      );
  });
  for (const slide of view.slides)
    if (slide.kind === 'result' && isGenericResultTitle(slide.title))
      issues.push(
        issue('generic-result-title', 'warning', '结果页标题过于宽泛，应写具体结论。', { slideId: slide.id }),
      );
  const firstByMessage = new Map<string, string>();
  for (const slide of view.slides) {
    const key = normalizeText(slide.message);
    if (!key) continue;
    if (firstByMessage.has(key))
      issues.push(issue('duplicate-message', 'warning', '多页使用了相同的本页结论。', { slideId: slide.id }));
    else firstByMessage.set(key, slide.id);
  }
  const evidenceSignature = (slide: NarrativeSlide) =>
    [
      [...slide.claimIds].sort().join(','),
      slide.figures
        .map((figure) => `${figure.figureId}:${figure.panelId ?? ''}`)
        .sort()
        .join(','),
      normalizeText(slide.message),
      normalizeText(slide.purpose),
    ].join('|');
  const firstByEvidence = new Map<string, string>();
  for (const slide of view.slides) {
    if (!slide.claimIds.length && !slide.figures.length) continue;
    const key = evidenceSignature(slide);
    if (firstByEvidence.has(key))
      issues.push(
        issue('repeated-evidence-without-distinct-purpose', 'warning', '多页使用相同证据集合且缺少不同目的。', {
          slideId: slide.id,
        }),
      );
    else firstByEvidence.set(key, slide.id);
  }
  for (const slide of view.slides)
    if (slide.figures.length === 4)
      issues.push(issue('many-panels', 'warning', '单页 Panel 较多，请注意可读性。', { slideId: slide.id }));
  const ending = lastMeaningfulSection(view);
  if (ending && ['synthesis', 'takeaways'].includes(ending.kind)) {
    const endingSlides = view.slides.filter((slide) => slide.sectionId === ending.id);
    const last = endingSlides.at(-1);
    if (last) {
      const previous = view.slides[view.slides.indexOf(last) - 1];
      const message = normalizeText(last.message);
      if (previous && message && message === normalizeText(previous.message))
        issues.push(issue('weak-ending', 'warning', '收尾页与前一页结论重复。', { slideId: last.id }));
    }
  }
  return issues;
}
