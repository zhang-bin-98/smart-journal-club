import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5174/';
const output = join(tmpdir(), 'smartjc-checks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.SMARTJC_BROWSER || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  console.log(await page.evaluate(async () => (await import('/tests/contracts.ts')).runContracts()));
  console.log(await page.evaluate(async () => (await import('/tests/analysis-contracts.ts')).runAnalysisContracts()));
  console.log(
    await page.evaluate(async () => (await import('/tests/generation-contracts.ts')).runGenerationContracts()),
  );
  console.log(await page.evaluate(async () => (await import('/tests/ai-contracts.ts')).runAiContracts()));
  let modelCase = 'success';
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    if (modelCase === 'authentication') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'invalid key', type: 'authentication_error' } }),
      });
      return;
    }
    const content = modelCase === 'invalid' ? '{"result":{"unexpected":true}}' : '{"result":{"connected":true}}';
    const body = `data: ${JSON.stringify({ id: 'fixed', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-fixed', type: 'function', function: { name: 'submit_result', arguments: content } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixed', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  assert.deepEqual(
    await page.evaluate(async () => (await import('/tests/analysis-contracts.ts')).fixedModelRequest()),
    { connected: true },
  );
  for (const [kind, code] of [
    ['invalid', 'invalid-output'],
    ['authentication', 'authentication'],
  ]) {
    modelCase = kind;
    assert.equal(
      await page.evaluate(async () => {
        try {
          await (await import('/tests/analysis-contracts.ts')).fixedModelRequest();
        } catch (error) {
          return error.code;
        }
      }),
      code,
    );
  }
  await page.unroute('https://api.deepseek.com/chat/completions');
  console.log('PASS: Pi AI fixed SSE/JSON/authentication/invalid output');
  await page.goto(`${base}#/fixture`);
  const title = page.getByRole('textbox', { name: '幻灯片标题', exact: true });
  await title.fill('中文草稿');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionstart', { data: '' });
  await title.fill('中文组合输入');
  assert.equal(await title.evaluate((el) => el === document.activeElement), true);
  await title.dispatchEvent('compositionend', { data: '输入' });
  await page.locator('[data-slide-id="slide-2"]').click();
  await page.locator('[data-slide-id="slide-1"]').click();
  assert.equal(await title.innerText(), '中文组合输入');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await title.innerText(), '一个可追溯的研究结论');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await title.innerText(), '中文组合输入');
  await page.getByRole('button', { name: '下移本页', exact: true }).click();
  assert.equal(await page.locator('[data-slide-id][aria-current="page"]').getAttribute('data-slide-id'), 'slide-1');
  assert.deepEqual(await page.locator('[data-slide-id]').evaluateAll((els) => els.map((el) => el.dataset.slideId)), [
    'slide-2',
    'slide-1',
    'slide-3',
  ]);
  await page.locator('[data-slide-id="slide-2"]').click();
  await page.locator('[data-slide-preview="current"] [data-element-id="f1"]').click();
  await page.getByRole('button', { name: '删除选中元素', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '选择布局' }).inputValue(), 'text-only');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const fixtureDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await fixtureDownload).saveAs(join(output, 'fixture.pptx'));
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '删除本页', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '导出 PPTX', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('[data-slide-id]').count(), 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.locator('[data-slide-id]').count(), 1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '新增页', exact: true }).first().click();
  assert.equal(await page.locator('[data-slide-id]').count(), 1);
  console.log('PASS: React draft/focus/composition/selection/reorder/undo/redo/empty/export');

  const generationCalls = [];
  let holdDeck = true;
  let heldRoute;
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const request = route.request().postDataJSON();
    const content = request.messages.find((message) => message.role === 'user').content;
    const data = JSON.parse(typeof content === 'string' ? content : content.find((item) => item.type === 'text').text);
    const stage = data.plan ? 'generate' : data.layoutRules ? 'plan' : data.strategies ? 'understand' : 'figures';
    generationCalls.push(stage);
    if (stage === 'generate' && holdDeck) {
      heldRoute = route;
      return;
    }
    const result = await page.evaluate(
      async ({ stage, data }) => {
        if (stage === 'figures')
          return {
            figures:
              data.pageNumber === 8
                ? [
                    {
                      label: 'Figure 3',
                      caption: '固定图注',
                      description: '固定图源',
                      bbox: { x: 0.12, y: 0.2, width: 0.76, height: 0.58 },
                      panels: [],
                    },
                  ]
                : [],
          };
        if (stage === 'understand') return (await import('/tests/analysis-contracts.ts')).understanding(data.paper);
        const fixed = await import('/tests/generation-contracts.ts');
        return stage === 'plan' ? fixed.fixedPlan(data.paper) : fixed.fixedSlides(data.plan);
      },
      { stage, data },
    );
    const body = `data: ${JSON.stringify({ id: 'fixed', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-fixed', type: 'function', function: { name: 'submit_result', arguments: JSON.stringify({ result }) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixed', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.goto(base);
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/shared/llm/settingsRepository.ts');
    const { DEFAULT_SETTINGS } = await import('/src/shared/llm/model.ts');
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'fixed-test-key' });
  });
  await page.reload();
  await page.getByLabel('选择论文 PDF').setInputFiles(resolve('test-fixtures/papers/mechanism-modt-cdifficile.pdf'));
  await page.waitForURL(/project/);
  const generationRequest = page.waitForRequest(
    (request) => {
      if (!request.url().includes('api.deepseek.com')) return false;
      return request.postData().includes('制作完整幻灯片');
    },
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: '生成 PPT', exact: true }).click();
  await generationRequest;
  const id = page.url().split('/project/')[1];
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '重试当前步骤', exact: true }).waitFor();
  if (heldRoute) await heldRoute.abort().catch(() => {});
  const priorCalls = [...generationCalls];
  const checkpoint = await page.evaluate(
    async (id) =>
      (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).project.checkpoint,
    id,
  );
  assert.equal(checkpoint, 'deck-plan-ready');
  holdDeck = false;
  await page.reload();
  await page.getByRole('button', { name: '继续生成', exact: true }).click();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  assert.deepEqual(generationCalls.slice(priorCalls.length), ['generate']);
  console.log('PASS: upload/all stages/cancel/reload/resume only incomplete stage/editor entry');
  const generated = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  const resultId = generated.slides[1].id;
  const firstFigureId = generated.slides[1].elements.find((element) => element.type === 'figure').id;
  await page.locator(`[data-slide-id="${resultId}"]`).click();
  await page.locator(`[data-slide-preview="current"] [data-element-id="${firstFigureId}"]`).click();
  await page.getByRole('button', { name: '裁图', exact: true }).click();
  await page.getByText('正在加载原页…').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('canvas').evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 230 && pixels[i + 3] > 0) count++;
      return count > 1000;
    }),
    true,
  );
  await page.screenshot({ path: join(output, 'source-desktop.png'), fullPage: true });
  const bounds = await page.locator('[data-pdf-page]').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '应用到本页', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const saved = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  assert.ok(saved.slides[1].elements.find((e) => e.id === firstFigureId).cropOverride);
  assert.equal(saved.slides[2].elements.find((e) => e.type === 'figure').cropOverride, undefined);
  assert.equal(saved.revision, 1);
  const editingTitle = page.getByRole('textbox', { name: '幻灯片标题', exact: true });
  await page.evaluate(() => {
    window.__smartjcOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'decks') throw new DOMException('fixed failure', 'QuotaExceededError');
      return window.__smartjcOriginalPut.apply(this, args);
    };
  });
  await editingTitle.fill('保存失败后仍保留的草稿');
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  assert.ok(page.url().includes('/project/'));
  assert.equal(await editingTitle.innerText(), '保存失败后仍保留的草稿');
  assert.equal(
    await page.evaluate(
      async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck.revision,
      id,
    ),
    1,
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__smartjcOriginalPut;
    delete window.__smartjcOriginalPut;
  });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.reload();
  await page.locator('[data-slide-preview="current"] img').waitFor();
  assert.equal(await page.locator('[data-slide-id][aria-current="page"]').getAttribute('data-slide-id'), resultId);
  assert.ok(
    (await page.locator('[data-slide-preview="current"] img').getAttribute('src')).startsWith('data:image/png;base64,'),
  );
  await page.unroute('https://api.deepseek.com/chat/completions');
  let aiMode = 'first';
  let heldAiRoute;
  let markAiHeld;
  const aiHeld = new Promise((resolve) => {
    markAiHeld = resolve;
  });
  const aiEvent = (delta, reason) => {
    const chunk = (value, finish_reason) =>
      `data: ${JSON.stringify({ id: 'fixed-ai-ui', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`;
    return `${chunk({ role: 'assistant', ...delta }, null) + chunk({}, reason)}data: [DONE]\n\n`;
  };
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const request = route.request().postDataJSON();
    const classify = request.tools.some((tool) => tool.function.name === 'submit_result');
    const afterTool = request.messages.some((message) => message.role === 'tool');
    if (afterTool && aiMode === 'held') {
      heldAiRoute = route;
      markAiHeld();
      return;
    }
    const args = classify
      ? { result: { mode: 'revision', needsStrategy: false } }
      : {
          scope: { type: 'slides', slideIds: [generated.slides[0].id] },
          summary: aiMode === 'first' ? '精简第一页标题' : '再次调整第一页标题',
          mutations: [
            {
              type: 'update-slide',
              slideId: generated.slides[0].id,
              changes: { title: aiMode === 'first' ? 'AI 固定标题' : 'AI 再次修改标题' },
            },
          ],
        };
    const body = afterTool
      ? aiEvent({ content: '已完成指定页标题修改。' }, 'stop')
      : aiEvent(
          {
            tool_calls: [
              {
                index: 0,
                id: `call-ai-${aiMode}`,
                type: 'function',
                function: {
                  name: classify ? 'submit_result' : 'deck__apply_revision',
                  arguments: JSON.stringify(args),
                },
              },
            ],
          },
          'tool_calls',
        );
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  const aiInput = page.getByRole('textbox', { name: 'AI 输入', exact: true });
  const beforeAi = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  await aiInput.fill('第 1 页标题短一点');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('修改摘要：精简第一页标题', { exact: true }).waitFor();
  const firstSummaryUndo = page.getByRole('button', { name: '撤销本次修改', exact: true }).first();
  assert.equal(await firstSummaryUndo.isDisabled(), false);
  const afterAi = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  assert.equal(afterAi.slides[0].title, 'AI 固定标题');
  assert.equal(afterAi.slides[1].title, beforeAi.slides[1].title);
  assert.equal(afterAi.revision, beforeAi.revision + 1);
  await firstSummaryUndo.click();
  await page.getByRole('button', { name: '重做', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(
    async ({ id, revision }) =>
      (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck.revision === revision,
    { id, revision: afterAi.revision + 1 },
  );
  assert.equal(
    (
      await page.evaluate(
        async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
        id,
      )
    ).slides[0].title,
    beforeAi.slides[0].title,
  );
  assert.equal(await firstSummaryUndo.isDisabled(), true);
  aiMode = 'second';
  await aiInput.fill('第 1 页标题再精简一些');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('修改摘要：再次调整第一页标题', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '撤销本次修改', exact: true }).last().isDisabled(), false);
  await editingTitle.fill('AI 之后的手工修改');
  await aiInput.click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '撤销本次修改', exact: true }).last().isDisabled(), true);
  const beforeCancelledAi = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  aiMode = 'held';
  await aiInput.fill('第 1 页标题继续精简');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await aiHeld;
  assert.equal(await aiInput.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '模型设置', exact: true }).isDisabled(), true);
  await page.locator(`[data-slide-id="${generated.slides[2].id}"]`).click();
  assert.equal(await aiInput.isDisabled(), true);
  await page.locator('[data-slide-id][aria-current=page]').filter({ hasText: generated.slides[2].title }).waitFor();
  await editingTitle.fill('手工草稿优先');
  await page.getByText('已转为手工编辑', { exact: true }).waitFor();
  assert.equal(await aiInput.isDisabled(), false);
  assert.equal(
    (
      await page.evaluate(
        async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
        id,
      )
    ).revision,
    beforeCancelledAi.revision,
  );
  await heldAiRoute.abort().catch(() => {});
  await aiInput.click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const afterCancelledAi = await page.evaluate(
    async (id) => (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).deck,
    id,
  );
  assert.equal(afterCancelledAi.slides[0].title, beforeCancelledAi.slides[0].title);
  assert.equal(afterCancelledAi.slides[2].title, '手工草稿优先');
  assert.equal(afterCancelledAi.revision, beforeCancelledAi.revision + 1);
  await page.reload();
  await page.getByText('修改摘要：精简第一页标题', { exact: true }).waitFor();
  await page.getByText('修改摘要：再次调整第一页标题', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '撤销本次修改', exact: true })
      .evaluateAll((buttons) => buttons.every((button) => button.disabled)),
    true,
  );
  assert.equal(
    (
      await page.evaluate(
        async (id) => (await import('/src/modules/assistant/conversationRepository.ts')).loadHistory(id),
        id,
      )
    ).length,
    4,
  );
  await page.unroute('https://api.deepseek.com/chat/completions');
  console.log('PASS: AI send/explicit target/summary top undo/manual draft cancels staged candidate/history reopen');
  const beforeRegeneration = await page.evaluate(
    async (id) => (await import('/src/modules/project/projectRepository.ts')).loadProject(id),
    id,
  );
  const regenerationCalls = [];
  let holdRegeneration = true;
  let heldRegenerationRoute;
  let markRegenerationHeld;
  const regenerationHeld = new Promise((resolve) => {
    markRegenerationHeld = resolve;
  });
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const request = route.request().postDataJSON();
    const content = request.messages.find((message) => message.role === 'user').content;
    const data = JSON.parse(typeof content === 'string' ? content : content.find((item) => item.type === 'text').text);
    const stage = data.plan ? 'generate' : 'plan';
    regenerationCalls.push(stage);
    if (stage === 'generate' && holdRegeneration) {
      heldRegenerationRoute = route;
      markRegenerationHeld();
      return;
    }
    const result = await page.evaluate(
      async ({ stage, data }) => {
        const fixed = await import('/tests/generation-contracts.ts');
        return stage === 'plan'
          ? { strategyId: 'general', plan: fixed.fixedPlan(data.paper) }
          : fixed.fixedSlides(data.plan);
      },
      { stage, data },
    );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: aiEvent(
        {
          tool_calls: [
            {
              index: 0,
              id: `call-regeneration-${stage}`,
              type: 'function',
              function: { name: 'submit_result', arguments: JSON.stringify({ result }) },
            },
          ],
        },
        'tool_calls',
      ),
    });
  });
  async function beginRegeneration() {
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('button', { name: '重新生成整套 PPT', exact: true }).click();
    await page.getByRole('textbox', { name: '重生成要求', exact: true }).fill('重新生成三页，重点保留研究结果');
    await page.getByRole('button', { name: '开始重生成', exact: true }).click();
  }
  await beginRegeneration();
  await regenerationHeld;
  assert.equal(
    await page.locator('[data-slide-preview=current] [data-edit-key=title]').getAttribute('contenteditable'),
    'false',
  );
  await page.getByRole('button', { name: '取消重生成', exact: true }).click();
  await page.getByRole('button', { name: '取消重生成', exact: true }).waitFor({ state: 'hidden' });
  await heldRegenerationRoute.abort().catch(() => {});
  let versionData = await page.evaluate(
    async (id) => (await import('/src/modules/project/projectRepository.ts')).loadProject(id),
    id,
  );
  assert.equal(versionData.deck.id, beforeRegeneration.deck.id);
  assert.deepEqual(versionData.project.preferences, beforeRegeneration.project.preferences);
  holdRegeneration = false;
  await beginRegeneration();
  await page.waitForFunction(
    async ({ id, previous }) =>
      (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).project.currentDeckId !==
      previous,
    { id, previous: beforeRegeneration.deck.id },
  );
  await page.getByRole('button', { name: '取消重生成', exact: true }).waitFor({ state: 'hidden' });
  versionData = await page.evaluate(
    async (id) => (await import('/src/modules/project/projectRepository.ts')).loadProject(id),
    id,
  );
  assert.deepEqual(regenerationCalls, ['plan', 'generate', 'plan', 'generate']);
  assert.equal(versionData.project.previousDeckId, beforeRegeneration.deck.id);
  assert.equal(versionData.project.preferences.instruction, '重新生成三页，重点保留研究结果');
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isDisabled(), true);
  await editingTitle.fill('重生成后的手工编辑');
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '恢复上一版', exact: true }).click();
  await page.waitForFunction(
    async ({ id, previous }) =>
      (await (await import('/src/modules/project/projectRepository.ts')).loadProject(id)).project.currentDeckId ===
      previous,
    { id, previous: beforeRegeneration.deck.id },
  );
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isDisabled(), true);
  await page.reload();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '恢复上一版', exact: true }).waitFor();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  const restoredVersion = await page.evaluate(
    async (id) => (await import('/src/modules/project/projectRepository.ts')).loadProject(id),
    id,
  );
  assert.equal(restoredVersion.deck.revision, beforeRegeneration.deck.revision + 1);
  assert.equal(restoredVersion.project.previousDeckId, versionData.deck.id);
  assert.deepEqual(restoredVersion.deck.slides, beforeRegeneration.deck.slides);
  await page.unroute('https://api.deepseek.com/chat/completions');
  console.log(
    'PASS: regenerate only plan/generate/cancel preserves current/success preferences/restore/reopen/clear undo',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs(join(output, 'paper.pptx'));
  await page.screenshot({ path: join(output, 'editor-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('dialog', { name: 'AI 助手', exact: true }).waitFor();
  assert.equal(await aiInput.isVisible(), true);
  await page.getByRole('button', { name: '关闭AI 助手', exact: true }).click();
  await page.getByRole('dialog', { name: 'AI 助手', exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(output, 'editor-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: PDF upload/parse/canvas/source/crop-isolation/save/reopen/rebuild/export/mobile');
  console.log('Artifacts:', output);
} finally {
  await browser.close();
}
