import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { responsesEvent } from './responses-fixture.ts';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5174/';
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => import('/src/app/activity.ts').then(({ isAppIdle }) => isAppIdle()));
  console.log(await page.evaluate(async () => (await import('/tests/settings-contracts.ts')).settingsContracts()));
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByRole('main', { name: '模型配置', exact: true });
  const url = settings.getByLabel('Base URL', { exact: true });
  const model = settings.getByLabel('模型 ID', { exact: true });
  const key = settings.getByLabel('API Key', { exact: true });
  const effort = settings.getByLabel('思考强度', { exact: true });
  const contextTokens = settings.getByLabel('上下文窗口（Token）', { exact: true });
  const outputTokens = settings.getByLabel('最大输出 Token', { exact: true });
  const concurrency = settings.getByLabel('模型请求并发数', { exact: true });
  const firstTimeout = settings.getByLabel('首响应超时（秒）', { exact: true });
  const idleTimeout = settings.getByLabel('无数据超时（秒）', { exact: true });
  const totalTimeout = settings.getByLabel('单次请求总时长（秒）', { exact: true });
  const save = settings.getByRole('button', { name: '保存并返回', exact: true });
  const back = settings.getByRole('button', { name: '返回项目列表', exact: true });
  const check = settings.getByRole('button', { name: '测试连接', exact: true });
  const success = settings.getByText('连接成功；本次未检查完整应用能力，配置尚未保存。', { exact: true });
  const received = [];
  let hold;
  let markHeld;
  const held = new Promise((resolve) => {
    markHeld = resolve;
  });
  let mode = 'success';
  await page.route('**/responses', async (route) => {
    const body = route.request().postDataJSON();
    received.push({
      effort: body.reasoning?.effort,
      hasReasoning: Object.hasOwn(body, 'reasoning'),
      maxTokens: body.max_output_tokens,
    });
    if (mode === 'hold') {
      hold = route;
      markHeld();
      return;
    }
    if (mode === 'authentication') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":{"message":"fixed-secret must stay private"}}',
      });
      return;
    }
    const input = JSON.stringify(body.input);
    let delta = { content: 'OK' };
    if (input.includes('input_image')) delta = { content: '7392' };
    else if (body.tool_choice)
      delta = { tool_calls: [{ function: { name: 'check_echo', arguments: '{"value":"TOOL_OK"}' } }] };
    else if (body.text?.format?.type === 'json_schema') delta = { content: '{"connected":true}' };
    else if (input.includes('STREAM_OK')) delta = { content: 'STREAM_OK' };
    await route.fulfill({ contentType: 'text/event-stream', body: responsesEvent(delta) });
  });
  await url.fill('https://models.example/custom/v1/responses/');
  await model.fill('fixture');
  await key.fill('fixed-secret');
  assert.equal(await contextTokens.inputValue(), '');
  assert.equal(await outputTokens.inputValue(), '');
  assert.equal(await concurrency.inputValue(), '5');
  assert.equal(await firstTimeout.inputValue(), '180');
  assert.equal(await idleTimeout.inputValue(), '180');
  assert.equal(await totalTimeout.inputValue(), '');
  await concurrency.fill('7');
  await firstTimeout.fill('120');
  await idleTimeout.fill('240');
  await totalTimeout.fill('600');
  await contextTokens.fill('1048576');
  await outputTokens.fill('1048576');
  await save.click();
  await settings.getByText('最大输出 Token 必须小于上下文窗口，为输入内容留出空间。', { exact: true }).waitFor();
  assert.equal(received.length, 0);
  await outputTokens.fill('131072');
  await check.click();
  await success.waitFor();
  assert.equal(received[0].hasReasoning, false);
  assert.equal(received[0].maxTokens, 2048);
  await settings.getByRole('button', { name: '检查应用所需能力', exact: true }).click();
  await settings.getByText('本次能力检查结束，请查看逐项结果。配置尚未保存。', { exact: true }).waitFor();
  assert.equal(
    await settings
      .locator('li strong')
      .filter({ hasText: /^通过$/ })
      .count(),
    4,
  );
  for (const value of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    await effort.selectOption(value);
    assert.equal(
      await settings
        .locator('li strong')
        .filter({ hasText: /^未检查$/ })
        .count(),
      4,
    );
    await check.click();
    await success.waitFor();
    assert.equal(received.at(-1).effort, value);
  }
  await outputTokens.fill('65536');
  assert.equal(await success.count(), 0);
  await save.click();
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  assert.equal(await url.inputValue(), 'https://models.example/custom/v1');
  assert.equal(await contextTokens.inputValue(), '1048576');
  assert.equal(await outputTokens.inputValue(), '65536');
  assert.equal(await concurrency.inputValue(), '7');
  assert.equal(await firstTimeout.inputValue(), '120');
  assert.equal(await idleTimeout.inputValue(), '240');
  assert.equal(await totalTimeout.inputValue(), '600');
  await page.reload();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await settings.waitFor();
  assert.equal(await contextTokens.inputValue(), '1048576');
  assert.equal(await outputTokens.inputValue(), '65536');
  assert.equal(await concurrency.inputValue(), '7');
  assert.equal(await firstTimeout.inputValue(), '120');
  assert.equal(await idleTimeout.inputValue(), '240');
  assert.equal(await totalTimeout.inputValue(), '600');
  await model.fill('unsaved');
  await page.evaluate(() => {
    window.__settingsPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'settings') throw new DOMException('fixed', 'QuotaExceededError');
      return window.__settingsPut.apply(this, args);
    };
  });
  await save.click();
  await settings.getByText('配置保存失败，请保留当前输入并检查本地存储后重试。', { exact: true }).waitFor();
  assert.equal(await model.inputValue(), 'unsaved');
  assert.equal(
    await page.evaluate(
      async () => (await (await import('/src/app/composition.ts')).settingsService.load()).settings.modelId,
    ),
    'fixture',
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__settingsPut;
    delete window.__settingsPut;
  });
  await settings.getByRole('button', { name: '清除已保存 Key', exact: true }).click();
  await settings.getByText('已清除保存的 Key，其他已保存配置和项目成果保留。', { exact: true }).waitFor();
  assert.equal(await model.inputValue(), 'fixture');
  assert.equal(await key.inputValue(), '');
  assert.equal(await contextTokens.inputValue(), '1048576');
  assert.equal(await outputTokens.inputValue(), '65536');
  assert.equal(await concurrency.inputValue(), '7');
  assert.equal(await firstTimeout.inputValue(), '120');
  assert.equal(await idleTimeout.inputValue(), '240');
  assert.equal(await totalTimeout.inputValue(), '600');
  await model.fill('discard-this');
  await settings.getByRole('button', { name: '恢复已保存配置', exact: true }).click();
  assert.equal(await model.inputValue(), 'fixture');
  await key.fill('fixed-secret');
  mode = 'hold';
  await check.click();
  await held;
  await page.waitForFunction(() =>
    import('/src/app/composition.ts').then(({ modelScheduler }) => modelScheduler.snapshot().running === 1),
  );
  await model.fill('changed-during-check');
  await hold.fulfill({ contentType: 'text/event-stream', body: responsesEvent({ content: 'OK' }) }).catch(() => {});
  assert.equal(await success.count(), 0);
  mode = 'authentication';
  await check.click();
  await settings.getByText('模型认证失败，请检查 API Key 后重试。', { exact: true }).waitFor();
  assert.equal((await settings.innerText()).includes('fixed-secret'), false);
  await page.evaluate(async () => {
    window.__finishSettingsTask = (await import('/src/app/activity.ts')).beginActivity();
  });
  await page.waitForFunction((button) => button.disabled, await save.elementHandle());
  assert.equal(await save.isDisabled(), true);
  assert.equal(await settings.getByRole('button', { name: '清除本应用所有数据', exact: true }).isDisabled(), true);
  await page.waitForFunction((button) => button.disabled, await check.elementHandle());
  assert.equal(await check.isDisabled(), true);
  const rejected = await page.evaluate(async () => {
    const { settingsService } = await import('/src/app/composition.ts');
    try {
      await settingsService.clearKey();
      return false;
    } catch (error) {
      return error.code === 'busy';
    }
  });
  assert.equal(rejected, true);
  await back.click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.waitForFunction((button) => button.disabled, await save.elementHandle());
  assert.equal(await save.isDisabled(), true);
  assert.equal(await settings.getByRole('button', { name: '清除本应用所有数据', exact: true }).isDisabled(), true);
  await page.evaluate(() => {
    window.__finishSettingsTask();
    delete window.__finishSettingsTask;
  });
  await page.context().setOffline(true);
  await page.waitForFunction((button) => button.disabled, await check.elementHandle());
  assert.equal(await check.isDisabled(), true);
  await page.waitForFunction((button) => !button.disabled, await save.elementHandle());
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await settings.waitFor({ state: 'hidden' });
  await page.context().setOffline(false);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await settings.waitFor();
  await page.screenshot({ path: resolve('output/playwright/model-settings-fixed.png') });
  await back.click();
  assert.equal(
    await page
      .getByRole('button', { name: '模型设置', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.evaluate(() => {
    document.querySelector('main').style.minHeight = '2400px';
    window.scrollTo(0, 420);
  });
  await page.getByRole('button', { name: '模型设置', exact: true }).evaluate((button) => button.click());
  await back.click();
  await page.waitForFunction(() => window.scrollY === 420);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: settings token validation/persistence/reload/check budget, save/clear/restore/return, all effort payloads, capabilities, failed save, stale response, busy/offline and key redaction',
  );
} finally {
  await browser.close();
}
