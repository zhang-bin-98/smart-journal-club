import { describe, expect, it } from 'vitest';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
import {
  beforeResultsSection,
  missingFigureSourceIds,
  outlineIssueGuidance,
  outlineIssueKey,
} from '../../src/modules/outline/ui/issueGuidance';
import { validatePlanNarrative } from '../../src/modules/outline/validateNarrative';
import { OutlineSession } from '../../src/modules/outline/OutlineSession';
import type { NarrativeIssue } from '../../src/modules/outline/narrativeRules';

function panelCase() {
  const paper = narrativePaper();
  const plan = narrativePlan();
  const figure = paper.figures[0];
  figure.panels = [];
  for (const label of ['A', 'B']) {
    paper.sources.push({ ...paper.sources[0], id: `source-${label}`, kind: 'panel' });
    figure.panels.push({ id: `panel-${label}`, label, description: '固定子图', sourceId: `source-${label}` });
  }
  const slide = plan.slides.find((item) => item.id === 'n-slide-result-1')!;
  slide.figures = ['A', 'B'].map((label) => ({ figureId: figure.id, panelId: `panel-${label}` }));
  slide.layoutId = 'two-figures';
  return { paper, plan, slide };
}

describe('大纲提示位置、修改说明与可撤销引用补全', () => {
  it('同页同图的不同 Panel 有独立位置和 key，并显示大纲页号与原文页号', () => {
    const { paper, plan } = panelCase();
    const issues = validatePlanNarrative(plan, paper).errors.filter((item) => item.code === 'figure-source-mismatch');
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.panelId)).toEqual(['panel-A', 'panel-B']);
    expect(outlineIssueKey(issues[0])).not.toBe(outlineIssueKey(issues[1]));
    expect(outlineIssueGuidance(issues[1], plan, paper)).toMatchObject({
      targetId: 'n-slide-result-1',
      field: 'figures',
      location: expect.stringContaining('第 5 页'),
      hint: expect.stringContaining('补全本页图源引用'),
    });
    expect(outlineIssueGuidance(issues[1], plan, paper).location).toContain('Panel B（原文第 1 页）');
  });

  it('结论警告定位其实际结果页；没有结果页时也说明未分配而不假称第一页', () => {
    const paper = narrativePaper();
    const plan = narrativePlan();
    const issue: NarrativeIssue = {
      code: 'focus-underallocated',
      severity: 'warning',
      message: '重点',
      claimId: paper.claims[0].id,
    };
    expect(outlineIssueGuidance(issue, plan, paper)).toMatchObject({
      targetId: 'n-slide-result-1',
      field: 'claims',
      location: expect.stringContaining(paper.claims[0].text),
    });
    plan.slides.forEach((slide) => {
      slide.claimIds = [];
    });
    expect(outlineIssueGuidance(issue, plan, paper).location).toContain('尚未分配结果页');
  });

  it('全局研究问题缺项不定位第一章；提供明确操作说明和结果前的插入点', () => {
    const guide = outlineIssueGuidance(
      { code: 'question-required', severity: 'error', message: '缺问题' },
      narrativePlan(),
      narrativePaper(),
    );
    expect(guide.targetId).toBeUndefined();
    expect(guide.location).toContain('全局结构');
    expect(guide.hint).toContain('页面职责');
    expect(beforeResultsSection(narrativePlan())).toBe('n-sec-study-design');
    const plan = narrativePlan();
    plan.sections = [];
    plan.slides = [];
    expect(beforeResultsSection(plan)).toBeNull();
  });

  it('预算和内容问题定位实际字段，不混淆章节和页面', () => {
    const plan = narrativePlan();
    const paper = narrativePaper();
    expect(
      outlineIssueGuidance(
        { code: 'budget-mismatch', severity: 'error', message: '预算', sectionId: plan.sections[1].id },
        plan,
        paper,
      ),
    ).toMatchObject({ targetId: plan.sections[1].id, field: 'budget' });
    expect(
      outlineIssueGuidance(
        { code: 'content-message-required', severity: 'error', message: '内容', slideId: plan.slides[1].id },
        plan,
        paper,
      ),
    ).toMatchObject({ targetId: plan.slides[1].id, field: 'message' });
  });

  it('来源补全只使用所选子图的真实来源，不改变 Paper、已有来源、图源选择或预算，保存可撤销', async () => {
    const { paper, plan, slide } = panelCase();
    const before = structuredClone({ paper, plan });
    const sources = missingFigureSourceIds(slide, paper);
    expect(sources).toEqual(['source-A', 'source-B']);
    const session = new OutlineSession(plan, paper, 'test-project');
    await session.commit({
      ...session.capture(),
      mutations: [
        {
          type: 'update-slide',
          slideId: slide.id,
          patch: { sourceIds: [...slide.sourceIds, ...sources] },
        },
      ],
    });
    const saved = session.current;
    expect(validatePlanNarrative(saved, paper).errors.some((issue) => issue.code === 'figure-source-mismatch')).toBe(
      false,
    );
    expect(saved.sections).toEqual(plan.sections);
    expect(saved.slides.find((item) => item.id === slide.id)?.figures).toEqual(slide.figures);
    expect({ paper, plan }).toEqual(before);
    await session.undo();
    expect(session.current.slides).toEqual(plan.slides);
  });

  it('未知 Panel 不降级猜成整图；已有来源不重复补入', () => {
    const { paper, slide } = panelCase();
    slide.figures = [{ figureId: paper.figures[0].id, panelId: 'missing-panel' }];
    expect(missingFigureSourceIds(slide, paper)).toEqual([]);
    slide.figures = [{ figureId: paper.figures[0].id }];
    expect(missingFigureSourceIds(slide, paper)).toEqual([]);
  });
});
