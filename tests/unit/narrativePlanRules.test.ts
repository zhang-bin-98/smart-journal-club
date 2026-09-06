import { describe, expect, it } from 'vitest';
import { narrativePaper, narrativePlan, paperWithoutDesign, paperWithSecondClaim } from '../narrative-fixture';
import { validatePlanNarrative } from '../../src/modules/outline/validateNarrative';
import type { NarrativeIssue } from '../../src/modules/outline/narrativeRules';
import type { DeckPlan } from '../../src/modules/outline/outline.schema';
import type { Paper } from '../../src/modules/paper/paper.schema';

const validate = (plan: DeckPlan, paper: Paper = narrativePaper()) => validatePlanNarrative(plan, paper);
const codes = (issues: NarrativeIssue[]) => issues.map((item) => item.code);
const findIssue = (issues: NarrativeIssue[], code: string) => issues.find((item) => item.code === code)!;
const slide = (plan: DeckPlan, id: string) => plan.slides.find((item) => item.id === id)!;
const section = (plan: DeckPlan, id: string) => plan.sections.find((item) => item.id === id)!;

describe('计划叙事校验：合法结构', () => {
  it('基础组学叙事无 error 无 warning', () => {
    expect(validate(narrativePlan())).toEqual({ errors: [], warnings: [] });
  });

  it('确认版基础结构同样合法（预算逐章一致）', () => {
    expect(validate(narrativePlan('confirmed'))).toEqual({ errors: [], warnings: [] });
  });

  it('论文无设计事实且结构无设计章节时合法', () => {
    const plan = narrativePlan();
    plan.sections = plan.sections.filter((item) => item.id !== 'n-sec-study-design');
    plan.slides = plan.slides.filter((item) => item.id !== 'n-slide-method');
    expect(validate(plan, paperWithoutDesign())).toEqual({ errors: [], warnings: [] });
  });

  it('多个独立 results 章节合法', () => {
    const plan = narrativePlan();
    plan.slides.forEach((item) => {
      if (item.sectionId === 'n-sec-results')
        item.sectionId = Number(item.id.at(-1)) > 4 ? 'n-sec-results-b' : 'n-sec-results-a';
    });
    section(plan, 'n-sec-results').id = 'n-sec-results-a';
    section(plan, 'n-sec-results-a').slideBudget = 4;
    plan.sections.splice(4, 0, { ...section(plan, 'n-sec-results-a'), id: 'n-sec-results-b', slideBudget: 3 });
    expect(validate(plan)).toEqual({ errors: [], warnings: [] });
  });

  it('limitations 与 discussion 可在最终综合之前，custom 过渡章不改变收尾规则', () => {
    const plan = narrativePlan();
    const limitations = section(plan, 'n-sec-limitations');
    const discussion = { ...limitations, id: 'n-sec-discussion', kind: 'discussion' as const, title: '讨论' };
    const custom = { ...limitations, id: 'n-sec-custom', kind: 'custom' as const, title: '过渡', purpose: '' };
    plan.sections.splice(5, 0, discussion, custom);
    const sample = slide(plan, 'n-slide-result-2');
    [8, 9].forEach((index) => {
      plan.slides.splice(11, 0, {
        ...sample,
        id: `n-slide-result-${index}`,
        title: `结局 ${index} 的组间差异`,
        message: `处理组在结局 ${index} 上出现一致方向的变化。`,
        purpose: `说明结局 ${index} 的证据与方向。`,
      });
    });
    const anchor = plan.slides.findIndex((item) => item.id === 'n-slide-limitations');
    plan.slides.splice(anchor + 1, 0, {
      id: 'n-slide-discussion',
      sectionId: 'n-sec-discussion',
      kind: 'discussion',
      title: '如何解释这些结果',
      purpose: '讨论研究含义',
      message: '效应机制仍需后续验证。',
      layoutId: 'text-only',
      claimIds: [],
      sourceIds: [],
      figures: [],
    });
    expect(validate(plan)).toEqual({ errors: [], warnings: [] });
  });

  it('draft 空计划不产生问题，confirmed 空计划报 empty-plan', () => {
    const draft = narrativePlan();
    draft.slides = [];
    expect(validate(draft)).toEqual({ errors: [], warnings: [] });
    const confirmed = narrativePlan('confirmed');
    confirmed.slides = [];
    const result = validate(confirmed);
    expect(result.errors.map((item) => item.code)).toEqual(['empty-plan']);
    expect(result.warnings).toEqual([]);
  });
});

describe('计划叙事校验：骨架 errors', () => {
  it('首章不是 opening 或首页不是 title 报 opening-required', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-opening').kind = 'custom';
    const issue = findIssue(validate(plan).errors, 'opening-required');
    expect(issue.sectionId).toBe('n-sec-opening');
    expect(issue.slideId).toBe('n-slide-title');
    const titleVariant = narrativePlan();
    slide(titleVariant, 'n-slide-title').kind = 'custom';
    expect(codes(validate(titleVariant).errors)).toContain('opening-required');
  });

  it('首个结果之前缺背景职责报 background-required', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-background').kind = 'custom';
    slide(plan, 'n-slide-background').kind = 'custom';
    expect(codes(validate(plan).errors)).toEqual(['background-required']);
  });

  it('缺研究问题报 question-required；问题可由 background 章内 question 页承担', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-question').kind = 'background';
    expect(codes(validate(plan).errors)).toEqual(['question-required']);
  });

  it('论文含设计事实而缺设计职责报 study-design-required', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-study-design').kind = 'custom';
    slide(plan, 'n-slide-method').kind = 'background';
    expect(codes(validate(plan).errors)).toEqual(['study-design-required']);
  });

  it('无 results 章节与 result 页报 results-required', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-results').kind = 'custom';
    plan.slides.forEach((item) => {
      if (item.kind === 'result') item.kind = 'custom';
    });
    expect(codes(validate(plan).errors)).toEqual(['results-required']);
  });

  it('最后非自定义章节不是综合或结论报 ending-required', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-takeaways').kind = 'limitations';
    const issue = findIssue(validate(plan).errors, 'ending-required');
    expect(issue.sectionId).toBe('n-sec-takeaways');
  });

  it('opening 重复、前置职责在结果后、收尾后结果分别报 invalid-section-order', () => {
    const duplicated = narrativePlan();
    duplicated.sections.splice(1, 0, { ...section(duplicated, 'n-sec-opening'), id: 'n-sec-opening-2' });
    const duplicateIssues = validate(duplicated).errors.filter((item) => item.code === 'invalid-section-order');
    expect(duplicateIssues).toHaveLength(1);
    expect(duplicateIssues[0].sectionId).toBe('n-sec-opening-2');

    const movedBackground = narrativePlan();
    const background = section(movedBackground, 'n-sec-background');
    movedBackground.sections = movedBackground.sections.filter((item) => item.id !== background.id);
    movedBackground.sections.splice(4, 0, background);
    const movedIssues = validate(movedBackground).errors.filter((item) => item.code === 'invalid-section-order');
    expect(movedIssues).toHaveLength(1);
    expect(movedIssues[0].sectionId).toBe('n-sec-background');

    const resultsAfterEnding = narrativePlan();
    const results = section(resultsAfterEnding, 'n-sec-results');
    resultsAfterEnding.sections = resultsAfterEnding.sections.filter((item) => item.id !== results.id);
    resultsAfterEnding.sections.push(results);
    const endingIssues = validate(resultsAfterEnding).errors;
    expect(endingIssues.filter((item) => item.code === 'invalid-section-order')).toHaveLength(1);
    expect(findIssue(endingIssues, 'ending-required').sectionId).toBe('n-sec-results');
  });
});

describe('计划叙事校验：结构引用 errors', () => {
  it('页面引用不存在的章节报 unknown-section', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-question').sectionId = 'n-sec-ghost';
    const issue = findIssue(validate(plan).errors, 'unknown-section');
    expect(issue.slideId).toBe('n-slide-question');
    expect(issue.sectionId).toBe('n-sec-ghost');
  });

  it('章节 ID 重复报 duplicate-id', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-background').id = 'n-sec-opening';
    const issue = findIssue(validate(plan).errors, 'duplicate-id');
    expect(issue.sectionId).toBe('n-sec-opening');
  });

  it('同章页面不连续报 noncontiguous-section-slides', () => {
    const plan = narrativePlan();
    const result = plan.slides.splice(4, 1)[0];
    plan.slides.splice(1, 0, result);
    const issue = findIssue(validate(plan).errors, 'noncontiguous-section-slides');
    expect(issue.sectionId).toBe('n-sec-results');
    expect(issue.slideId).toBe('n-slide-result-2');
  });
});

describe('计划叙事校验：内容与引用 errors', () => {
  it('结果页无有效结论报 result-claim-required', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-3').claimIds = [];
    const issue = findIssue(validate(plan).errors, 'result-claim-required');
    expect(issue.slideId).toBe('n-slide-result-3');
  });

  it('结果页目的为空报 result-purpose-required', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-3').purpose = '';
    const issue = findIssue(validate(plan).errors, 'result-purpose-required');
    expect(issue.slideId).toBe('n-slide-result-3');
  });

  it('内容页缺 take-home 报 content-message-required，标题与 custom 页豁免', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-background').message = '';
    const issue = findIssue(validate(plan).errors, 'content-message-required');
    expect(issue.slideId).toBe('n-slide-background');
  });

  it('引用不存在的结论与来源报 unknown-claim / unknown-source', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-3').claimIds = ['claim-ghost'];
    const claimErrors = validate(plan).errors;
    expect(findIssue(claimErrors, 'unknown-claim').claimId).toBe('claim-ghost');
    expect(findIssue(claimErrors, 'result-claim-required').slideId).toBe('n-slide-result-3');

    const sourcePlan = narrativePlan();
    slide(sourcePlan, 'n-slide-result-3').sourceIds = ['source-ghost'];
    expect(findIssue(validate(sourcePlan).errors, 'unknown-source').slideId).toBe('n-slide-result-3');
  });

  it('引用不存在的图与子图报 unknown-figure / unknown-panel', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-1').figures = [{ figureId: 'fig-ghost' }];
    expect(findIssue(validate(plan).errors, 'unknown-figure').figureId).toBe('fig-ghost');

    const panelPlan = narrativePlan();
    slide(panelPlan, 'n-slide-result-1').figures = [{ figureId: 'fig-3', panelId: 'panel-ghost' }];
    expect(findIssue(validate(panelPlan).errors, 'unknown-panel').figureId).toBe('fig-3');
  });

  it('图源未落入页面来源报 figure-source-mismatch', () => {
    const plan = narrativePlan();
    const takeaways = slide(plan, 'n-slide-takeaways');
    takeaways.layoutId = 'figure-full';
    takeaways.figures = [{ figureId: 'fig-3' }];
    const issue = findIssue(validate(plan).errors, 'figure-source-mismatch');
    expect(issue.slideId).toBe('n-slide-takeaways');
    expect(issue.figureId).toBe('fig-3');
  });

  it('布局容量不足报 invalid-layout-figure-count，复用 layoutRules 契约', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-1').figures = [{ figureId: 'fig-3' }, { figureId: 'fig-3' }];
    expect(codes(validate(plan).errors)).toEqual(['invalid-layout-figure-count']);

    const overflow = narrativePlan();
    const result = slide(overflow, 'n-slide-result-1');
    result.layoutId = 'panel-grid';
    result.figures = [1, 2, 3, 4, 5].map(() => ({ figureId: 'fig-3' }));
    const result5 = validate(overflow);
    expect(codes(result5.errors)).toEqual(['invalid-layout-figure-count']);
    expect(codes(result5.warnings)).not.toContain('many-panels');
  });
});

describe('计划叙事校验：证据链', () => {
  it('结论证据来源与页面来源无交集报 claim-evidence-source-mismatch', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-2').sourceIds = [];
    const issue = findIssue(validate(plan).errors, 'claim-evidence-source-mismatch');
    expect(issue.slideId).toBe('n-slide-result-2');
    expect(issue.claimId).toBe('claim-fixture');
  });

  it('页面引用其他结论的证据来源同样报 mismatch', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-2').sourceIds = ['source-panel-a'];
    const result = validate(plan, paperWithSecondClaim());
    expect(codes(result.errors)).toEqual(['claim-evidence-source-mismatch']);
  });

  it('结论证据与页面来源匹配时通过', () => {
    const plan = narrativePlan();
    const result = validate(plan, paperWithSecondClaim());
    expect(result.errors).toEqual([]);
  });
});

describe('计划叙事校验：计划专属规则', () => {
  it('draft 预算不匹配不报错，confirmed 报 budget-mismatch', () => {
    const draft = narrativePlan();
    section(draft, 'n-sec-results').slideBudget = 3;
    expect(codes(validate(draft).errors)).toEqual([]);
    const confirmed = narrativePlan('confirmed');
    section(confirmed, 'n-sec-results').slideBudget = 3;
    expect(findIssue(validate(confirmed).errors, 'budget-mismatch').sectionId).toBe('n-sec-results');
  });

  it('confirmed 空章节报 empty-confirmed-section，draft 不报', () => {
    const confirmed = narrativePlan('confirmed');
    confirmed.sections.push({
      ...section(confirmed, 'n-sec-takeaways'),
      id: 'n-sec-extra',
      kind: 'custom',
      slideBudget: 0,
    });
    expect(findIssue(validate(confirmed).errors, 'empty-confirmed-section').sectionId).toBe('n-sec-extra');
    const draft = narrativePlan();
    draft.sections.push({ ...section(draft, 'n-sec-takeaways'), id: 'n-sec-extra', kind: 'custom', slideBudget: 0 });
    expect(codes(validate(draft).errors)).toEqual([]);
  });

  it('omit 结论仍被引用时每个引用页报 omit-claim-referenced', () => {
    const plan = narrativePlan();
    plan.claimEmphasis = [{ claimId: 'claim-fixture', emphasis: 'omit' }];
    const issues = validate(plan).errors.filter((item) => item.code === 'omit-claim-referenced');
    expect(issues).toHaveLength(7);
    expect(issues[0].slideId).toBe('n-slide-result-1');
    expect(issues[0].claimId).toBe('claim-fixture');
  });

  it('重点设置引用不存在的结论报 unknown-claim', () => {
    const plan = narrativePlan();
    plan.claimEmphasis = [{ claimId: 'claim-ghost', emphasis: 'focus' }];
    expect(findIssue(validate(plan).errors, 'unknown-claim').claimId).toBe('claim-ghost');
  });

  it('focus 结论不足两页结果仅提示 focus-underallocated，不进 errors', () => {
    const plan = narrativePlan();
    plan.claimEmphasis = [
      { claimId: 'claim-2', emphasis: 'focus' },
      { claimId: 'claim-fixture', emphasis: 'focus' },
    ];
    const result = validate(plan, paperWithSecondClaim());
    expect(result.errors).toEqual([]);
    const warnings = result.warnings.filter((item) => item.code === 'focus-underallocated');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].claimId).toBe('claim-2');
  });
});

describe('计划叙事校验：warnings', () => {
  it('背景页超过四分之一报 background-heavy', () => {
    const plan = narrativePlan();
    const background = slide(plan, 'n-slide-background');
    [1, 2, 3, 4].forEach((index) => {
      plan.slides.splice(2, 0, {
        ...background,
        id: `n-slide-background-${index}`,
        title: `补充背景 ${index}`,
        message: `背景补充说明 ${index}。`,
        purpose: `补充背景 ${index}`,
      });
    });
    expect(codes(validate(plan).warnings)).toContain('background-heavy');
  });

  it('结果页不足一半报 results-light', () => {
    const plan = narrativePlan();
    plan.slides = plan.slides.filter((item) => !['4', '5', '6', '7'].some((n) => item.id.endsWith(n)));
    expect(codes(validate(plan).warnings)).toEqual(['results-light']);
  });

  it('缺局限与批判讨论报 critical-discussion-missing', () => {
    const plan = narrativePlan();
    plan.sections = plan.sections.filter((item) => item.id !== 'n-sec-limitations');
    plan.slides = plan.slides.filter((item) => item.id !== 'n-slide-limitations');
    expect(codes(validate(plan).warnings)).toEqual(['critical-discussion-missing']);
  });

  it('非末尾章节缺过渡报 transition-missing', () => {
    const plan = narrativePlan();
    section(plan, 'n-sec-opening').transitionToNext = '';
    const issue = findIssue(validate(plan).warnings, 'transition-missing');
    expect(issue.sectionId).toBe('n-sec-opening');
  });

  it('有限标签集内的结果标题报 generic-result-title', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-3').title = '结果';
    slide(plan, 'n-slide-result-4').title = 'Figure 3';
    const issues = validate(plan).warnings.filter((item) => item.code === 'generic-result-title');
    expect(issues.map((item) => item.slideId)).toEqual(['n-slide-result-3', 'n-slide-result-4']);
  });

  it('规范化后相同的 take-home 报 duplicate-message', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-3').message = `  处理组在结局 2 上出现一致方向的变化。 `;
    const issue = findIssue(validate(plan).warnings, 'duplicate-message');
    expect(issue.slideId).toBe('n-slide-result-3');
  });

  it('相同证据集合且无区分目的报 repeated-evidence-without-distinct-purpose', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-result-4').message = slide(plan, 'n-slide-result-3').message;
    slide(plan, 'n-slide-result-4').purpose = slide(plan, 'n-slide-result-3').purpose;
    const issues = validate(plan).warnings.filter((item) => item.code === 'repeated-evidence-without-distinct-purpose');
    expect(issues.map((item) => item.slideId)).toEqual(['n-slide-result-4']);
  });

  it('四个 Panel 的合法页仅报 many-panels', () => {
    const plan = narrativePlan();
    const result = slide(plan, 'n-slide-result-1');
    result.layoutId = 'panel-grid';
    result.figures = [1, 2, 3, 4].map(() => ({ figureId: 'fig-3', panelId: 'fig-3-panel-a' }));
    const validation = validate(plan);
    expect(validation.errors).toEqual([]);
    expect(findIssue(validation.warnings, 'many-panels').slideId).toBe('n-slide-result-1');
  });

  it('收尾页与前一页结论相同报 weak-ending', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-takeaways').message = slide(plan, 'n-slide-synthesis').message;
    expect(findIssue(validate(plan).warnings, 'weak-ending').slideId).toBe('n-slide-takeaways');
  });

  it('同一非法计划的两次校验结果完全一致', () => {
    const plan = narrativePlan();
    slide(plan, 'n-slide-question').kind = 'background';
    slide(plan, 'n-slide-result-3').title = '结果';
    plan.claimEmphasis = [{ claimId: 'claim-ghost', emphasis: 'focus' }];
    const first = validatePlanNarrative(structuredClone(plan), narrativePaper());
    const second = validatePlanNarrative(structuredClone(plan), narrativePaper());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).toEqual(first);
    expect(first.errors.length + first.warnings.length).toBeGreaterThan(2);
  });
});
