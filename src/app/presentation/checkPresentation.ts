import type { Deck } from '../../modules/presentation/editing/schema';
import { computeLayout } from '../../modules/presentation/layout/computeLayout';
import { validateDeck } from '../../modules/presentation/editing/validateDeck';
import type { NarrativeIssue } from '../../modules/presentation/legacy/narrativeRules';
import { validateDeckNarrative } from '../../modules/presentation/legacy/validateNarrative';
import type { Paper as LegacyPaper } from '../../modules/paper/paper.schema';
import type { Paper as CurrentPaper } from '../../modules/paper/model';
import { toLegacyPaper } from '../../modules/paper/migration';
type Paper = LegacyPaper | CurrentPaper;

export type CheckCategory = 'structure' | 'narrative' | 'visual' | 'resource';
export type PresentationIssue = NarrativeIssue & { category: CheckCategory };
export type ReviewReminder = { code: string; message: string };
export interface PresentationCheck {
  version: string;
  errors: PresentationIssue[];
  warnings: PresentationIssue[];
  reviews: ReviewReminder[];
  hasFigures: boolean;
  resourceAvailable: boolean;
}
export type PresentationExportOptions = { warningsAcceptedFor?: string };

const REVIEW_REMINDERS: ReviewReminder[] = [
  { code: 'review-causality', message: '复核相关性、预测或时间轨迹是否被写成因果结论。' },
  { code: 'review-population', message: '复核物种、组织、细胞、队列与组别是否和原文一致。' },
  { code: 'review-endpoint', message: '复核主要终点、证据强度及图例/统计信息是否完整。' },
];

export const presentationVersion = (deck: Pick<Deck, 'id' | 'revision'>) => `${deck.id}:${deck.revision}`;

function structuralIssue(deck: Deck, message: string): PresentationIssue {
  const slide = deck.slides.find((item) => message.includes(item.id));
  const element = deck.slides.flatMap((item) => item.elements).find((item) => message.includes(item.id));
  const section = deck.sections.find((item) => message.includes(item.id));
  return {
    code: 'deck-structure',
    severity: 'error',
    category: 'structure',
    message,
    sectionId: section?.id ?? slide?.sectionId,
    slideId: slide?.id,
    elementId: element?.id,
  };
}

function visualIssues(deck: Deck): PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  for (const slide of deck.slides) {
    const layout = computeLayout(slide);
    const titleLength = [...slide.title].reduce(
      (count, char) => count + ((char.codePointAt(0) ?? 0) > 0xff ? 2 : 1),
      0,
    );
    if (titleLength > 52)
      issues.push({
        code: 'title-long',
        severity: 'warning',
        category: 'visual',
        message: '标题较长，请确认在预览和导出中仍清晰可读。',
        sectionId: slide.sectionId,
        slideId: slide.id,
      });
    if (layout.titleText.overflow || layout.messageText.overflow || layout.elements.some((item) => item.text.overflow))
      issues.push({
        code: 'text-overflow',
        severity: deck.schemaVersion === 3 ? 'error' : 'warning',
        category: 'visual',
        message: '文字可能溢出或过于拥挤，请精简内容、调整布局或拆页。',
        sectionId: slide.sectionId,
        slideId: slide.id,
      });
    for (const item of layout.elements) {
      if (item.element.type !== 'figure' || item.rect.width * item.rect.height >= 0.11) continue;
      issues.push({
        code: 'figure-small',
        severity: 'warning',
        category: 'visual',
        message: 'Figure 显示区域较小，请确认图例、坐标与统计信息可读。',
        sectionId: slide.sectionId,
        slideId: slide.id,
        elementId: item.element.id,
        figureId: item.element.figureId,
      });
    }
  }
  return issues;
}

function uniqueIssues(issues: PresentationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = [item.code, item.message, item.sectionId, item.slideId, item.elementId].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 检查页、章节导航和导出用例共用的确定性检查；人工复核项只作提醒，不冒充科学判定。 */
export function checkPresentation(deck: Deck, paper: Paper, resourceAvailable: boolean): PresentationCheck {
  const narrative =
    deck.schemaVersion === 3
      ? { errors: [], warnings: [] }
      : validateDeckNarrative(deck, paper.schemaVersion === 2 ? toLegacyPaper(paper) : paper);
  const hasFigures = deck.slides.some((slide) => slide.elements.some((element) => element.type === 'figure'));
  const resourceIssues: PresentationIssue[] = !resourceAvailable
    ? [
        {
          code: 'pdf-unavailable',
          severity: hasFigures ? 'error' : 'warning',
          category: 'resource',
          message: hasFigures
            ? '原 PDF 缺失，含图文稿无法核对来源或完整导出。'
            : '原 PDF 缺失，来源查看不可用；当前纯文字文稿仍可导出。',
        },
      ]
    : [];
  const structural = validateDeck(deck, paper).map((message) => structuralIssue(deck, message));
  const narrativeIssues = [...narrative.errors, ...narrative.warnings].map((item) => ({
    ...item,
    category: 'narrative' as const,
    severity: deck.schemaVersion === 3 ? ('warning' as const) : item.severity,
  }));
  const assigned = new Set(deck.slides.flatMap((s) => s.speechIds ?? []));
  const unassigned: PresentationIssue[] = deck.speech?.some((s) => !assigned.has(s.id))
    ? [
        {
          code: 'unassigned-speech',
          severity: 'warning',
          category: 'narrative',
          message: '部分讲稿尚未安排页面；原文保留，可在讲述分配中移入页面。',
        },
      ]
    : [];
  const contentWarnings: PresentationIssue[] =
    deck.schemaVersion === 3
      ? deck.slides
          .filter((slide) => !slide.title.trim())
          .map((slide) => ({
            code: 'empty-title',
            severity: 'warning',
            category: 'narrative',
            message: '本页标题为空，可按需要补充。',
            slideId: slide.id,
          }))
      : [];
  if (deck.schemaVersion === 3) {
    const covered = new Set([
      ...(deck.speech ?? []).flatMap((s) => s.claimIds),
      ...(deck.omissions ?? []).map((o) => o.claimId),
    ]);
    const missing = paper.claims.filter((claim) => !covered.has(claim.id));
    if (missing.length)
      contentWarnings.push({
        code: 'coverage-change',
        severity: 'warning',
        category: 'narrative',
        message: `有 ${missing.length} 项论文发现尚未在讲稿中表达，可回到大纲核对。`,
      });
    if (deck.omissions?.length)
      contentWarnings.push({
        code: 'user-omissions',
        severity: 'warning',
        category: 'narrative',
        message: '本稿保留了用户主动省略的发现记录。',
      });
    for (const slide of deck.slides) {
      const assigned = (deck.speech ?? []).filter((s) => slide.speechIds?.includes(s.id));
      if (
        assigned.some(
          (s) =>
            s.claimIds.some((id) => !slide.claimIds.includes(id)) ||
            s.sourceIds.some((id) => !slide.sourceIds.includes(id)),
        )
      )
        contentWarnings.push({
          code: 'page-update',
          severity: 'warning',
          category: 'narrative',
          slideId: slide.id,
          message: '讲稿的证据关联与本页不同，可按需要请求更新页面。',
        });
    }
  }
  const all = uniqueIssues([
    ...contentWarnings,
    ...structural,
    ...narrativeIssues,
    ...unassigned,
    ...visualIssues(deck),
    ...resourceIssues,
  ]);
  return {
    version: presentationVersion(deck),
    errors: all.filter((item) => item.severity === 'error'),
    warnings: all.filter((item) => item.severity === 'warning'),
    reviews: REVIEW_REMINDERS,
    hasFigures,
    resourceAvailable,
  };
}

export type CheckLocation = {
  slideId?: string;
  elementId?: string;
  inspectorTab: 'content' | 'source' | 'layout';
};

/** 将检查问题解析到一个真实可编辑位置；全局叙事缺项回到最接近的现有页面。 */
export function locatePresentationIssue(deck: Deck, issue: PresentationIssue): CheckLocation {
  const sectionSlide = issue.sectionId ? deck.slides.find((slide) => slide.sectionId === issue.sectionId) : undefined;
  const slide = deck.slides.find((item) => item.id === issue.slideId) ?? sectionSlide ?? deck.slides[0];
  return {
    slideId: slide?.id,
    elementId: issue.elementId,
    inspectorTab:
      issue.category === 'resource' || issue.elementId ? 'source' : issue.category === 'visual' ? 'layout' : 'content',
  };
}
