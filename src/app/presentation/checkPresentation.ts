import type { Deck } from '../../modules/deck/deck.schema';
import { computeLayout } from '../../modules/deck/layout/computeLayout';
import { validateDeck } from '../../modules/deck/validateDeck';
import type { NarrativeIssue } from '../../modules/outline/narrativeRules';
import { validateDeckNarrative } from '../../modules/outline/validateNarrative';
import type { Paper } from '../../modules/paper/paper.schema';

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
        severity: 'warning',
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
  const narrative = validateDeckNarrative(deck, paper);
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
  }));
  const all = uniqueIssues([...structural, ...narrativeIssues, ...visualIssues(deck), ...resourceIssues]);
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
