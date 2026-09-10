import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// 仅显式运行真实 Gate；凭据不写入脚本、日志、截图文字或结果文件。
const source = await readFile('.env', 'utf8');
const apiKey = source
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey, '需要本地 DeepSeek 验收凭据');
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const payloads = [];
  page.on('pageerror', () => errors.push('page-error'));
  page.on('response', async (response) => {
    if (response.url() !== 'https://api.deepseek.com/responses' || response.status() < 400) return;
    const body = await response.json().catch(() => ({}));
    const message = String(body.error?.message ?? '').toLowerCase();
    console.log('Provider diagnostic flags:', {
      status: response.status(),
      thinking: message.includes('thinking'),
      toolChoice: message.includes('tool_choice') || message.includes('tool choice'),
      strict: message.includes('strict'),
      required: message.includes('required'),
      reasoning: message.includes('reasoning'),
    });
  });
  page.on('request', (request) => {
    if (request.url() !== 'https://api.deepseek.com/responses' || request.method() !== 'POST') return;
    const body = request.postDataJSON();
    payloads.push({ effort: body.reasoning?.effort, hasReasoning: Object.hasOwn(body, 'reasoning') });
  });
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5174/');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByRole('main', { name: '模型配置', exact: true });
  const key = settings.getByLabel('API Key', { exact: true });
  const effort = settings.getByLabel('思考强度', { exact: true });
  const check = settings.getByRole('button', { name: '测试连接', exact: true });
  const success = settings.getByText('连接成功；本次未检查完整应用能力，配置尚未保存。', { exact: true });
  await settings.getByLabel('Base URL', { exact: true }).fill('https://api.deepseek.com');
  await settings.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
  await key.fill(apiKey);
  await check.click();
  await success.waitFor({ timeout: 190000 });
  assert.equal(payloads[0].hasReasoning, false);
  console.log('PASS: real browser Responses connection, default omits reasoning');
  await settings.getByRole('button', { name: '检查应用所需能力', exact: true }).click();
  await settings
    .getByText('本次能力检查结束，请查看逐项结果。配置尚未保存。', { exact: true })
    .waitFor({ timeout: 760000 });
  const results = await settings.locator('li').allTextContents();
  console.log('Real capabilities:', results.join(' | '));
  await page.screenshot({ path: resolve('output/playwright/model-settings-real.png') });
  assert.equal(
    await settings
      .locator('li strong')
      .filter({ hasText: /^通过$/ })
      .count(),
    4,
  );
  for (const value of ['none', 'low', 'high', 'max']) {
    await effort.selectOption(value);
    await check.click();
    await success.waitFor({ timeout: 190000 });
    assert.equal(payloads.at(-1).effort, value);
    console.log(`PASS: real browser reasoning.effort=${value}`);
  }
  const sent = page.waitForRequest(
    (request) => request.url() === 'https://api.deepseek.com/responses' && request.method() === 'POST',
  );
  await check.click();
  await sent;
  await settings.getByRole('button', { name: '取消检查', exact: true }).click();
  await settings.getByText('已取消检查，迟到结果不会回填。', { exact: true }).waitFor();
  assert.equal(await success.count(), 0);
  console.log('PASS: real browser request canceled through formal UI');
  await effort.selectOption('');
  await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  assert.ok((await key.inputValue()) === apiKey, '保存后凭据不一致');
  await settings.getByRole('button', { name: '清除已保存 Key', exact: true }).click();
  await settings.getByText('已清除保存的 Key，其他已保存配置和项目成果保留。', { exact: true }).waitFor();
  assert.ok((await key.inputValue()) === '', '清除凭据未生效');
  assert.deepEqual(errors, []);
  console.log('PASS: real credentials saved and cleared through formal UI');
} finally {
  await browser.close();
}
