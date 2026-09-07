import assert from 'node:assert/strict';
import { join } from 'node:path';

/** 在同一叙事 fixture 上完成提示→定位→修改→保存，不调用模型。 */
export async function checkOutlineGuidance(page, base, output) {
  await page.goto(base);
  const id = await page.evaluate(async () => {
    const { narrativePaper, narrativePlan } = await import('/tests/narrative-fixture.ts');
    const { createProject, saveStage } = await import('/src/modules/project/projectRepository.ts');
    const signal = new AbortController().signal;
    let project = await createProject(new File(['%PDF-fixture'], 'outline-guidance.pdf'));
    const paper = { ...narrativePaper(), id: project.paperId };
    const plan = { ...narrativePlan(), paperId: project.paperId };
    paper.figures[0].panels = [];
    for (const label of ['A', 'B']) {
      paper.sources.push({ ...paper.sources[0], id: `guide-source-${label}`, kind: 'panel' });
      paper.figures[0].panels.push({
        id: `guide-panel-${label}`,
        label,
        description: '固定子图',
        sourceId: `guide-source-${label}`,
      });
    }
    paper.claims.push({ ...paper.claims[0], id: 'guide-claim', text: '需要说明的第二条结论', importance: 'secondary' });
    plan.claimEmphasis = [{ claimId: 'guide-claim', emphasis: 'focus' }];
    plan.slides.find((slide) => slide.id === 'n-slide-question').kind = 'background';
    const first = plan.slides.find((slide) => slide.id === 'n-slide-result-1');
    first.figures = ['A', 'B'].map((label) => ({ figureId: paper.figures[0].id, panelId: `guide-panel-${label}` }));
    first.layoutId = 'two-figures';
    const second = plan.slides.find((slide) => slide.id === 'n-slide-result-2');
    second.figures = [{ figureId: paper.figures[0].id, panelId: 'guide-panel-A' }];
    second.layoutId = 'figure-full';
    second.claimIds.push('guide-claim');
    project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
    project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
    project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
    project = await saveStage(project, { checkpoint: 'deck-plan-ready', plan }, signal);
    return project.id;
  });
  const snapshot = () =>
    page.evaluate(
      async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).plan,
      id,
    );
  try {
    await page.goto(`${base}#/project/${id}`);
    const issues = page.getByRole('region', { name: '大纲检查与修改', exact: true });
    const editor = page.getByRole('region', { name: '大纲编辑区', exact: true });
    const panelIssue = issues.getByRole('button', { name: /定位修改：第 5 页.*Panel B.*页面来源/ });
    await panelIssue.waitFor();
    assert.equal(await issues.getByRole('button', { name: /页面来源未包含/ }).count(), 3);
    await page.screenshot({ path: join(output, 'outline-guidance-desktop.png'), fullPage: true });
    await panelIssue.click();
    await editor.getByRole('heading', { name: /正在编辑：第 5 页/ }).waitFor();
    const panel = editor.locator('[data-outline-panel="guide-panel-B"]');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-outline-panel') === 'guide-panel-B');
    assert.equal(await panel.evaluate((element) => element.className.includes('ring-2')), true);
    await page.locator('[data-outline-slide="n-slide-background"]').click();
    await panelIssue.click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-outline-panel') === 'guide-panel-B');
    await page.setViewportSize({ width: 390, height: 844 });
    await panelIssue.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'outline-guidance-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });

    const before = await snapshot();
    await editor.getByRole('button', { name: '补全本页图源引用', exact: true }).click();
    await issues.getByText(/当前有未保存输入/).waitFor();
    assert.equal(await panelIssue.isDisabled(), true);
    assert.deepEqual(await snapshot(), before);
    await editor.getByRole('button', { name: '取消页面修改', exact: true }).click();
    assert.deepEqual(await snapshot(), before);
    await editor.getByRole('button', { name: '补全本页图源引用', exact: true }).click();
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await panelIssue.waitFor({ state: 'hidden' });
    assert.equal(await issues.getByRole('button', { name: /页面来源未包含/ }).count(), 1);
    const repaired = await snapshot();
    assert.deepEqual(repaired.sections, before.sections);
    assert.deepEqual(repaired.slides[4].figures, before.slides[4].figures);
    await page.getByRole('button', { name: '撤销大纲', exact: true }).click();
    await panelIssue.waitFor();
    await page.getByRole('button', { name: '重做大纲', exact: true }).click();
    await panelIssue.waitFor({ state: 'hidden' });
    await page.reload();
    await issues.getByRole('button', { name: /定位修改：第 6 页.*页面来源/ }).waitFor();
    assert.equal(await issues.getByRole('button', { name: /页面来源未包含/ }).count(), 1);

    await issues.getByRole('button', { name: /定位修改：结论：需要说明的第二条结论/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-outline-claim') === 'guide-claim');
    await editor.getByRole('combobox', { name: '讲述重点：需要说明的第二条结论', exact: true }).selectOption('brief');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await issues.getByRole('button', { name: /重点结论建议/ }).waitFor({ state: 'hidden' });
    await issues.getByRole('button', { name: /定位修改：第 6 页.*页面来源/ }).click();
    await editor.getByRole('button', { name: '补全本页图源引用', exact: true }).click();
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await issues.getByRole('button', { name: /页面来源未包含/ }).waitFor({ state: 'hidden' });

    await issues.getByRole('button', { name: /定位修改：全局结构.*研究问题/ }).click();
    await editor.getByRole('button', { name: '在结果前添加研究问题章节', exact: true }).click();
    await editor.getByRole('heading', { name: '正在编辑章节：研究问题', exact: true }).waitFor();
    const withSection = await snapshot();
    const question = withSection.sections.find((section) => section.kind === 'question');
    assert.ok(
      withSection.sections.indexOf(question) < withSection.sections.findIndex((section) => section.kind === 'results'),
    );
    assert.equal(question.slideBudget, 0);
    await editor.getByRole('button', { name: '添加页面', exact: true }).click();
    await editor.getByRole('combobox', { name: '页面职责', exact: true }).waitFor();
    assert.equal(await editor.getByRole('combobox', { name: '页面职责', exact: true }).inputValue(), 'question');
    await issues.getByRole('button', { name: /内容页需要本页结论/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-outline-field') === 'message');
    await editor.getByRole('textbox', { name: '页面标题', exact: true }).fill('待检验的研究问题');
    await editor.getByRole('textbox', { name: '页面目的', exact: true }).fill('说明本研究要检验的问题');
    await editor.getByRole('textbox', { name: '本页结论', exact: true }).fill('固定研究是否改变预设终点？');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await issues.getByRole('button', { name: /内容页需要本页结论/ }).waitFor({ state: 'hidden' });
    await issues.getByRole('button', { name: /定位修改：章节：研究问题.*预算/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-outline-field') === 'budget');
    await editor.getByRole('spinbutton', { name: '页数预算', exact: true }).fill('1');
    await editor.getByRole('textbox', { name: '章节目的', exact: true }).fill('明确研究问题');
    await editor.getByRole('textbox', { name: '过渡到下一章', exact: true }).fill('接下来查看主要结果');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    await issues.getByRole('heading', { name: '需要修改 0 项 · 提醒 1 项', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认大纲', exact: true }).isDisabled(), true);
    await page.getByRole('checkbox', { name: '已核对警告，继续确认', exact: true }).check();
    assert.equal(await page.getByRole('button', { name: '确认大纲', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: '确认大纲', exact: true }).click();
    await page.getByText('大纲已确认，可以生成幻灯片。', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('大纲已确认，可以生成幻灯片。', { exact: true }).waitFor();
    console.log(
      'PASS: outline page/panel/claim/global location/repeated focus/dirty guard/cancel/save/undo/redo/reopen/manual question/budget/confirm/mobile',
    );
  } catch (error) {
    await page.screenshot({ path: join(output, 'outline-guidance-failure.png'), fullPage: true });
    throw error;
  } finally {
    await page.evaluate(
      async (id) => (await import('/src/modules/project/projectRepository.ts')).deleteProject(id),
      id,
    );
  }
}
