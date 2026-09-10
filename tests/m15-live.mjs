import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const askOnly = process.env.SMARTJC_M15_ASK_ONLY === '1';
const source = await readFile('.env', 'utf8');
const apiKey = source
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey, '需要用户已授权的本地验收凭据');
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m15-live'), {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const modelResults = [];
  const responseStatuses = [];
  page.on('response', async (response) => {
    if (!response.url().startsWith('https://api.deepseek.com/') || response.request().method() !== 'POST') return;
    try {
      const body = await response.text();
      for (const line of body.split(/\r?\n/)) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          responseStatuses.push({
            status: event.response?.status,
            reason: event.response?.incomplete_details?.reason,
            inputTokens: event.response?.usage?.input_tokens,
            outputTokens: event.response?.usage?.output_tokens,
            reasoningTokens: event.response?.usage?.output_tokens_details?.reasoning_tokens,
            completedResultCount: modelResults.length,
          });
          await writeFile(
            'output/playwright/m15-live-response-statuses.json',
            JSON.stringify(responseStatuses, null, 2),
          );
        }
        if (event.type !== 'response.function_call_arguments.done') continue;
        const args = JSON.parse(event.arguments);
        if (!args.result) continue;
        modelResults.push(args.result);
        await writeFile('output/playwright/m15-live-model-results.json', JSON.stringify(modelResults, null, 2));
      }
    } catch {
      // 取消或不完整流不形成验收结果，不保存原始响应、请求头或隐藏推理。
    }
  });
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5175/');
  await page.getByRole('button', { name: /^模型设置/ }).click();
  const settings = page.getByRole('main', { name: '模型配置', exact: true });
  await settings.getByLabel('Base URL', { exact: true }).fill('https://api.deepseek.com');
  await settings.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
  await settings.getByLabel('API Key', { exact: true }).fill(apiKey);
  await settings.getByLabel('思考强度', { exact: true }).selectOption(process.env.SMARTJC_M15_REASONING || 'high');
  await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
  const existing = await page.evaluate(async () => {
    const module = await import(
      performance.getEntriesByType('resource').find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))
        ?.name ?? '/src/app/composition.ts'
    );
    return (await module.projectsService.listManagedProjects()).find((project) => project.name === 'M15 真实全文验收');
  });
  if (existing) {
    await page
      .getByRole('row')
      .filter({ hasText: 'M15 真实全文验收' })
      .getByRole('button', { name: '打开', exact: true })
      .click();
    if (!askOnly && existing.analysisStatus !== '分析就绪')
      await page.getByRole('button', { name: /^(开始分析|继续分析|重试未完成部分)$/ }).click();
  } else {
    assert.equal(askOnly, false, '只读验收需要已有真实分析项目');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page
      .getByLabel('选择主论文 PDF', { exact: true })
      .setInputFiles(resolve('test-fixtures/papers/omics-torc1-proteomics.pdf'));
    await page.getByLabel('项目名称', { exact: true }).fill('M15 真实全文验收');
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
  }
  await page.waitForURL(/#\/project\//);
  const projectId = decodeURIComponent(page.url().split('#/project/')[1]);
  let last = '';
  const deadline = Date.now() + 40 * 60_000;
  while (!askOnly && Date.now() < deadline) {
    const state = await page.evaluate(async (id) => {
      const { analysisService } = await import(
        performance.getEntriesByType('resource').find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))
          ?.name ?? '/src/app/composition.ts'
      );
      const state = analysisService.session(id).snapshot();
      return {
        status: state.status,
        stage: state.stage,
        documentId: state.documentId,
        pageNumber: state.pageNumber,
        error: state.error,
        units: state.data?.paper.analysisUnits.length,
        ready: state.progress?.ready,
      };
    }, projectId);
    const summary = JSON.stringify(state);
    if (summary !== last) {
      console.log(summary);
      last = summary;
    }
    if (state.status === 'failed' || state.status === 'completed' || state.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const data = await page.evaluate(async (id) => {
    const { analysisService } = await import(
      performance.getEntriesByType('resource').find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))
        ?.name ?? '/src/app/composition.ts'
    );
    const { getAnalysisProgress } = await import('/src/modules/paper/analysisUnits.ts');
    await analysisService.session(id).load();
    const state = analysisService.session(id).snapshot();
    return {
      status: state.status,
      paper: state.data?.paper,
      progress: state.data ? getAnalysisProgress(state.data.paper) : undefined,
    };
  }, projectId);
  await writeFile('output/playwright/m15-real-analysis.json', JSON.stringify(data, null, 2));
  assert.ok(['completed', 'idle'].includes(data.status), data.status);
  if (!askOnly) assert.equal(data.progress.ready, true);
  assert.equal(data.paper.pages.length, 41);
  assert.ok(data.paper.claims.length > 0);
  await page.screenshot({ path: 'output/playwright/m15-real-analysis.png' });
  if (askOnly || process.env.SMARTJC_M15_ASK === '1') {
    await page.getByRole('button', { name: 'AI 问答', exact: true }).click();
    await page
      .getByLabel('论文问题', { exact: true })
      .fill(
        '请读取主论文文件内第19页原文：前人Ppk32研究中，哪些细胞更早恢复TORC1并改善交配？说明完整基因条件、前人研究归属，并标明文件和页码。',
      );
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await page.getByRole('button', { name: '取消问答', exact: true }).waitFor({ state: 'hidden', timeout: 240000 });
    const assistant = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'AI 只读问答', exact: true }) });
    assert.equal(await assistant.getByRole('alert').count(), 0);
    const answer = await assistant.locator('p.whitespace-pre-wrap').innerText();
    assert.match(answer, /Ppk32|ppk32/);
    assert.match(answer, /leu1.?32/i);
    assert.match(answer, /19/);
    const after = await page.evaluate(async (id) => {
      const { analysisService } = await import(
        performance.getEntriesByType('resource').find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))
          ?.name ?? '/src/app/composition.ts'
      );
      return (await analysisService.session(id).load()).paper;
    }, projectId);
    assert.deepEqual(after, data.paper);
    await writeFile('output/playwright/m15-real-answer.txt', answer);
    await page.screenshot({ path: 'output/playwright/m15-real-answer.png' });
    console.log('PASS: 真实只读问答读取原文并说明条件，论文底稿没有任何写入。');
  }
  assert.deepEqual(errors, []);
  if (!askOnly) console.log('PASS: 真实论文逐页分析、原句来源和完整汇总已保存；科学内容仍需独立核对输出。');
} finally {
  await browser.close();
}
