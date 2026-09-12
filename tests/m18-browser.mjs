import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { responsesEvent } from './responses-fixture.ts';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/';
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let page;
let calls = 0;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  const pdf = (await readFile('test-fixtures/papers/clinical-vrc07-phase1-trial.pdf')).toString('base64');
  const id = await page.evaluate(async (pdf) => {
    const { createM18Fixture } = await import('/tests/m18-fixture.ts');
    const { settingsService } = await import('/src/app/composition.ts');
    await settingsService.save({
      protocol: 'responses',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'fixed-model',
      apiKey: 'fixed-test-key',
      reasoningEffort: null,
    });
    return createM18Fixture(
      new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }),
    );
  }, pdf);
  let aiTurns = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    const body = route.request().postDataJSON();
    let delta;
    if (body.tools?.some((t) => t.name === 'propose_slide_changes')) {
      if (aiTurns++ === 0) {
        const user = body.input.filter((m) => m.role === 'user').at(-1);
        const input = JSON.parse(user.content.find((c) => c.type === 'input_text').text);
        const target = input.slides[0].id;
        delta = {
          tool_calls: [
            {
              id: 'proposal',
              function: {
                name: 'propose_slide_changes',
                arguments: JSON.stringify({
                  scope: { type: 'slides', slideIds: [target] },
                  summary: '精简标题',
                  mutations: [{ type: 'update-slide', slideId: target, changes: { title: 'AI 修改后的标题' } }],
                }),
              },
            },
          ],
        };
      } else delta = { content: '请查看修改前后差异。' };
    } else {
      calls++;
      const user = body.input.find((m) => m.role === 'user');
      const input = JSON.parse(user.content.find((c) => c.type === 'input_text').text);
      const sourceIndexes = input.figures.length >= 3 ? [0, 2, 3] : input.figures.length ? [0] : [];
      const result = {
        slides: [
          {
            title: input.section.title,
            purpose: '解释本页发现',
            message: '原图支持当前观察，保留解释边界。',
            kind: 'result',
            speechIndexes: input.speech.map((_, i) => i),
            sourceIndexes,
          },
        ],
      };
      delta = {
        tool_calls: [{ id: 'result', function: { name: 'submit_result', arguments: JSON.stringify({ result }) } }],
      };
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: responsesEvent(delta) });
  });
  await page.goto(base + '#/project/' + id);
  await page.reload();
  await page.getByRole('button', { name: '下一步：生成幻灯片', exact: true }).click();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  await page.getByText('完整幻灯片已保存', { exact: true }).first().waitFor({ timeout: 30000 });
  assert.equal(calls, 2);
  const saved = await page.evaluate(
    async (id) => (await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id)).current,
    id,
  );
  assert.equal(saved.slides.length, 2);
  assert.equal(saved.slides[0].figureGroup.root.kind, 'split');
  await page.getByRole('button', { name: '专注当前页', exact: true }).click();
  const title = page.getByRole('textbox', { name: '幻灯片标题', exact: true });
  await title.fill('手工修改的标题');
  await title.press('Tab');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="幻灯片标题"]')?.textContent !== '手工修改的标题',
  );
  assert.notEqual(await title.innerText(), '手工修改的标题');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="幻灯片标题"]')?.textContent === '手工修改的标题',
  );
  assert.equal(await title.innerText(), '手工修改的标题');
  await page.getByRole('button', { name: '图组', exact: true }).click();
  await page.getByRole('button', { name: '左二右一', exact: true }).click();
  await page.getByRole('button', { name: '应用排列', exact: true }).click();
  const ratio = page.getByRole('spinbutton', { name: '根分区比例数值', exact: true });
  await ratio.fill('0.35');
  await ratio.press('Tab');
  const gap = page.getByRole('spinbutton', { name: '图间距', exact: true });
  await gap.fill('18');
  await gap.press('Tab');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="图间距"]')?.value === '12');
  assert.equal(await gap.inputValue(), '12');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const separator = page.getByRole('separator', { name: '图组分隔线根', exact: true });
  await separator.focus();
  await separator.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[aria-label="根分区比例数值"]')?.value === '0.36');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="根分区比例数值"]')?.value === '0.35');
  const speech = page.getByRole('textbox', { name: '本页讲稿 1', exact: true });
  await speech.focus();
  await speech.press('Control+Home');
  for (let i = 0; i < 15; i++) await speech.press('ArrowRight');
  await page.getByRole('button', { name: '从光标 / 本段前换页', exact: true }).click();
  await page.getByRole('button', { name: '打开第 3 页', exact: true }).waitFor();
  const afterSplit = await page.evaluate(
    async (id) => (await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id)).current,
    id,
  );
  assert.equal(afterSplit.speechParagraphs[0].id, saved.speechParagraphs[0].id);
  await page.getByRole('button', { name: '与下一页合页', exact: true }).click();
  await page.getByRole('button', { name: '删除本页', exact: true }).click();
  await page.getByRole('button', { name: '讲述分配', exact: true }).click();
  await page.getByText(/待安排讲稿 · [1-9]/).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '展开 AI 输入', exact: true }).click();
  await page.getByLabel('AI 模式', { exact: true }).selectOption('edit');
  await page.getByRole('textbox', { name: '幻灯片 AI 输入', exact: true }).fill('精简本页标题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '应用 AI 修改', exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '应用 AI 修改', exact: true }).click();
  await page.getByRole('textbox', { name: '幻灯片标题', exact: true }).filter({ hasText: 'AI 修改后的标题' }).waitFor();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '收起 AI 输入', exact: true }).click();
  await page.getByRole('button', { name: '页面', exact: true }).click();
  await page.locator('[data-slide-preview="current"] [aria-label="选择 Figure"]').first().click();
  await page.getByRole('button', { name: '来源', exact: true }).click();
  await page.getByRole('dialog', { name: '原文与图源', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭来源', exact: true }).click();
  const beforeCrop = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  await page.getByRole('button', { name: '本页裁图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本页裁图', exact: true });
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"] [role="application"]')?.getAttribute('aria-busy') === 'false',
  );
  await dialog.getByRole('button', { name: '调整w边界', exact: true }).press('ArrowLeft');
  await dialog.getByRole('button', { name: '保存本页裁图', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const afterCrop = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(afterCrop.current.revision, beforeCrop.current.revision + 1);
  assert.deepEqual(afterCrop.paper, beforeCrop.paper);
  assert.ok(afterCrop.current.slides.flatMap((s) => s.elements).some((e) => e.cropOverride));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '重做', exact: true }).waitFor();
  await title.fill('页面文字溢出'.repeat(300));
  await title.press('Tab');
  let blockedDownloads = 0;
  const countBlocked = () => blockedDownloads++;
  page.on('download', countBlocked);
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await page
    .locator('[role="alert"]')
    .filter({ hasText: /溢出|放不下|空间/ })
    .waitFor();
  assert.equal(blockedDownloads, 0);
  page.off('download', countBlocked);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const exportSnapshot = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  await writeFile(
    'output/playwright/m18-export-snapshot.json',
    JSON.stringify({ deck: exportSnapshot.current, paper: exportSnapshot.paper }, null, 2),
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs('output/playwright/m18-fixed.pptx');
  await page.screenshot({ path: 'output/playwright/m18-workspace.png' });
  await page.reload();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  assert.equal(calls, 2);
  await writeFile(
    'output/playwright/m18-browser.json',
    JSON.stringify({ id, calls, errors, slides: afterSplit.slides.length }, null, 2),
  );
  const beforeBrowse = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  await page.getByRole('button', { name: '3 大纲与演讲稿', exact: true }).click();
  await page.getByRole('button', { name: '查看已有幻灯片', exact: true }).waitFor();
  const backwards = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(backwards.project.lastOpenedStep, 'outline-speech');
  assert.deepEqual(backwards.current, beforeBrowse.current);
  await page.getByRole('button', { name: '查看已有幻灯片', exact: true }).click();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  assert.equal(calls, 2);
  const storage = await page.evaluate(
    async (id) => (await import('/tests/m18-storage-contracts.ts')).verifySlidesStorage(id),
    id,
  );
  await writeFile('output/playwright/m18-storage.json', JSON.stringify(storage, null, 2));
  await page.reload();
  await page.getByRole('button', { name: '查看完整新稿', exact: true }).click();
  const versionDialog = page.getByRole('dialog', { name: '完整新稿候选', exact: true });
  await versionDialog.waitFor();
  await versionDialog
    .getByRole('button', { name: /页依据/ })
    .first()
    .click();
  await page.getByRole('dialog', { name: '原文与图源', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭来源', exact: true }).click();
  await versionDialog.getByRole('button', { name: '返回当前稿', exact: true }).click();
  const prefs = await page.evaluate(async (id) => {
    const { slidesStore } = await import('/src/infrastructure/persistence/slidesStore.ts');
    const { saveRequirements } = await import('/src/infrastructure/persistence/projectStore.ts');
    const s = await slidesStore.open(id);
    await saveRequirements(id, { ...s.project.preferences, instruction: 'stale UI' });
    return s.project.preferences;
  }, id);
  await page.reload();
  await page.getByRole('button', { name: '查看完整新稿', exact: true }).click();
  assert.equal(await versionDialog.getByRole('button', { name: '应用完整新稿', exact: true }).isDisabled(), true);
  await page.evaluate(
    async ({ id, prefs }) =>
      (await import('/src/infrastructure/persistence/projectStore.ts')).saveRequirements(id, prefs),
    { id, prefs },
  );
  await page.reload();
  await page.getByRole('button', { name: '查看完整新稿', exact: true }).click();
  await versionDialog.getByRole('button', { name: '应用完整新稿', exact: true }).click();
  await versionDialog.waitFor({ state: 'hidden' });
  const applied = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(applied.current.id, storage.candidateForUi);
  assert.equal(applied.previous.id, storage.currentForUi);
  await page.getByRole('button', { name: '上一版', exact: true }).click();
  await page
    .getByRole('dialog', { name: '上一版', exact: true })
    .getByRole('button', { name: '恢复上一版', exact: true })
    .click();
  await page.getByRole('dialog', { name: '上一版', exact: true }).waitFor({ state: 'hidden' });
  const restored = await page.evaluate(
    async (id) => await (await import('/src/infrastructure/persistence/slidesStore.ts')).slidesStore.open(id),
    id,
  );
  assert.equal(restored.current.id, storage.currentForUi);
  assert.equal(calls, 2);
  await page.screenshot({ path: 'output/playwright/m18-workspace-final.jpg', type: 'jpeg', quality: 80 });
  assert.deepEqual(errors, []);
  console.log('M18 browser main chain passed');
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'output/playwright/m18-failure.png' }).catch(() => {});
    await writeFile('output/playwright/m18-failure.txt', await page.locator('body').innerText()).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
