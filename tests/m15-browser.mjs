import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeResponseRequest, responsesEvent } from './responses-fixture.ts';

const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5175/';
const output = 'output/playwright';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.SMARTJC_BROWSER || 'msedge', headless: true });
const calls = [];
const topics = [
  'background',
  'knowledgeGap',
  'question',
  'studyDesign',
  'mainFindings',
  'novelty',
  'limitations',
  'conclusion',
];
let holdModels = true;
let held = [];
function releaseModels() {
  holdModels = false;
  for (const release of held) release();
  held = [];
}
function fixedResult(data) {
  if ('figureLabel' in data) return { panels: [], concerns: [] };
  if ('imageRegions' in data)
    return {
      figures: [
        {
          label: `Figure ${data.pageNumber}`,
          caption: '固定回归图注，仅验证事务与页面操作',
          description: '固定回归图源',
          bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
          panels: [],
        },
      ],
    };
  if ('blocks' in data) {
    const source = data.sources.find((item) => item.kind === 'figure') ?? data.sources[0];
    if (!source) return { claims: [], evidences: [] };
    return {
      claims: [
        {
          id: 'claim',
          text: '固定回归发现，仅验证来源绑定',
          strength: 'descriptive',
          importance: 'primary',
          evidenceIds: ['evidence'],
        },
      ],
      evidences: [{ id: 'evidence', kind: 'fixed-test', summary: '固定回归证据', sourceIds: [source.id] }],
    };
  }
  assert.ok(data.documents, '未知模型单元');
  const sourceId = data.evidences[0]?.sourceIds[0];
  assert.ok(sourceId);
  return {
    metadata: { ...data.metadata, title: '固定回归临床论文' },
    studyProfile: { type: '固定回归', designSummary: '此结果只用于行为回归，不用于科学验收', sourceIds: [sourceId] },
    story: Object.fromEntries(topics.map((topic) => [topic, []])),
  };
}
async function runtime(page) {
  return page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split('#/project/')[1]);
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))?.name;
    const { analysisService } = await import(url ?? '/src/app/composition.ts');
    const snapshot = analysisService.session(id).snapshot();
    const { getAnalysisProgress } = await import('/src/modules/paper/analysisUnits.ts');
    return {
      status: snapshot.status,
      error: snapshot.error,
      paper: snapshot.data?.paper,
      project: snapshot.data?.project,
      progress: snapshot.data && getAnalysisProgress(snapshot.data.paper),
    };
  });
}
async function waitFor(page, predicate, label, timeout = 240000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await runtime(page);
    if (state.status === 'failed') throw new Error(`${label}: ${state.error}`);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`超时：${label}`);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  await page.routeWebSocket('**', (socket) => socket.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://m15-fixed.example/responses', async (route) => {
    const request = decodeResponseRequest(route.request().postDataJSON());
    const content = request.messages.find((message) => message.role === 'user').content;
    const data = JSON.parse(typeof content === 'string' ? content : content.find((part) => part.type === 'text').text);
    const stage = 'imageRegions' in data ? 'figure' : 'blocks' in data ? 'evidence' : 'summary';
    calls.push({ stage, documentId: data.document?.id, pageNumber: data.pageNumber });
    const wasHeld = holdModels;
    if (wasHeld) await new Promise((resolve) => held.push(resolve));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: responsesEvent({
          tool_calls: [
            { function: { name: 'submit_result', arguments: JSON.stringify({ result: fixedResult(data) }) } },
          ],
        }),
      });
    } catch (cause) {
      if (!wasHeld) throw cause;
    }
  });
  await page.goto(base);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByRole('main', { name: '模型配置', exact: true });
  await settings.getByLabel('Base URL', { exact: true }).fill('https://m15-fixed.example');
  await settings.getByLabel('模型 ID', { exact: true }).fill('fixed-responses');
  await settings.getByLabel('API Key', { exact: true }).fill('fixed-key-not-secret');
  await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page
    .getByLabel('选择主论文 PDF', { exact: true })
    .setInputFiles(resolve('test-fixtures/papers/clinical-vrc07-phase1-trial.pdf'));
  await page.getByRole('button', { name: '移除主论文', exact: true }).waitFor();
  await page.getByLabel('项目名称', { exact: true }).fill('M15 固定响应主链');
  await page.getByLabel('汇报要求', { exact: false }).fill('固定初始化要求');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await page.waitForURL(/#\/project\//);
  await waitFor(page, (state) => state.status === 'running' && held.length > 0, '等待可暂停的真实请求');
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name)).name;
    const { analysisService } = await import(url);
    const session = analysisService.session(decodeURIComponent(location.hash.split('#/project/')[1]));
    const load = session.load;
    window.restoreM15Load = () => {
      session.load = load;
    };
    session.load = async () => {
      throw new Error('固定回归：首次读取失败');
    };
  });
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByText(/^分析中 · 已保存/).waitFor();
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await page.getByRole('button', { name: '重试读取', exact: true }).waitFor();
  await page.evaluate(() => window.restoreM15Load());
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await page.locator('#analysis-requirements').waitFor();
  assert.equal(await page.locator('#analysis-requirements').isEnabled(), true);
  assert.equal(await page.locator('#analysis-requirements').inputValue(), '固定初始化要求');
  await page.getByRole('button', { name: '暂停分析', exact: true }).click();
  const paused = await waitFor(page, (state) => state.status === 'paused', '暂停');
  assert.ok(paused.paper.analysisUnits.length > 0);
  const pausedUnits = paused.paper.analysisUnits.map((unit) => ({ id: unit.id, completedAt: unit.completedAt }));
  const pausedCalls = calls.length;
  releaseModels();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal((await runtime(page)).paper.analysisUnits.length, pausedUnits.length, '迟到模型结果不得提交');
  assert.equal(calls.length, pausedCalls, '暂停后不得继续派发');
  await page.reload();
  await page.getByRole('button', { name: '继续分析', exact: true }).waitFor();
  const reopened = await runtime(page);
  assert.equal(reopened.status, 'idle', '刷新不自动恢复运行');
  assert.equal(reopened.paper.analysisUnits.length, pausedUnits.length);
  console.log('PASS: 部分单元保存、暂停停止派发与迟到提交、刷新手动续跑');
  await page.getByRole('button', { name: '继续分析', exact: true }).click();
  let completed = await waitFor(
    page,
    (state) => state.status === 'completed' && state.progress.ready,
    '完成所有保存单元',
  );
  assert.equal(completed.paper.pages.length, 25);
  for (const prior of pausedUnits)
    assert.equal(
      completed.paper.analysisUnits.find((unit) => unit.id === prior.id)?.completedAt,
      prior.completedAt,
      '有效已保存单元被重复执行',
    );
  assert.equal(
    await page.getByRole('heading', { name: '论文分析', exact: true }).isVisible(),
    true,
    '分析完成不得自动切页',
  );
  await page.getByRole('button', { name: '下一步：图源核对', exact: true }).waitFor();
  assert.equal(
    await page.getByText('待提取文本', { exact: true }).count(),
    0,
    '完成态不得因 target 属性顺序误报待提取',
  );
  let selection = completed.paper.figurePageSelections.find(
    (item) => item.automatic !== 'detected' && item.manualOverride !== 'include',
  );
  if (!selection) {
    selection = completed.paper.figurePageSelections[0];
    await page.getByLabel(`主论文第 ${selection.pageNumber} 页作为图源页处理`, { exact: true }).click();
    await page.getByRole('button', { name: '确认取消图源处理', exact: true }).click();
    completed = await waitFor(
      page,
      (state) => state.status === 'completed' && state.progress.ready,
      '取消图源后的关联整理',
    );
    selection = completed.paper.figurePageSelections.find(
      (item) => item.documentId === selection.documentId && item.pageNumber === selection.pageNumber,
    );
  }
  const beforeAddition = calls.length;
  const beforeText = completed.paper.analysisUnits
    .filter((unit) => unit.stage === 'text')
    .map((unit) => ({ id: unit.id, completedAt: unit.completedAt }));
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('固定回归：选择保存失败', 'QuotaExceededError');
      }
      return original.call(this, stores, mode, options);
    };
  });
  const check = page.getByLabel(`主论文第 ${selection.pageNumber} 页作为图源页处理`, { exact: true });
  await check.click();
  await page.getByRole('button', { name: '重试保存选择', exact: true }).waitFor();
  await page.getByRole('button', { name: '下一步：图源核对', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '论文分析', exact: true }).isVisible(), true);
  assert.equal(calls.length, beforeAddition, '保存失败不能派发模型');
  const protectedUrl = page.url();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByText('图源页选择尚未保存，请先重试或撤销未保存选择。', { exact: true }).waitFor();
  assert.equal(page.url(), protectedUrl);
  await page.evaluate(() => {
    location.hash = '#/';
  });
  await page.waitForURL(protectedUrl);
  assert.equal(await page.getByRole('button', { name: '重试保存选择', exact: true }).isVisible(), true);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
    '未保存选择应保护刷新',
  );
  await page.getByRole('button', { name: '撤销未保存选择', exact: true }).click();
  assert.equal(await check.isChecked(), false);
  assert.equal(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
    '明确撤销应清除未保存保护',
  );
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('固定回归：再次选择保存失败', 'QuotaExceededError');
      }
      return original.call(this, stores, mode, options);
    };
  });
  await check.click();
  await page.getByRole('button', { name: '重试保存选择', exact: true }).waitFor();
  holdModels = true;
  await page.getByRole('button', { name: '重试保存选择', exact: true }).click();
  await waitFor(page, (state) => state.status === 'running' && held.length > 0, '就绪后补选自动启动必要局部处理');
  releaseModels();
  completed = await waitFor(
    page,
    (state) => state.status === 'completed' && state.progress.ready,
    '补选与关联刷新完成',
  );
  assert.equal(
    completed.paper.figurePageSelections.find(
      (item) => item.documentId === selection.documentId && item.pageNumber === selection.pageNumber,
    ).manualOverride,
    'include',
  );
  assert.deepEqual(
    calls
      .slice(beforeAddition)
      .filter((call) => call.stage === 'figure')
      .map((call) => call.pageNumber),
    [selection.pageNumber],
  );
  for (const prior of beforeText)
    assert.equal(completed.paper.analysisUnits.find((unit) => unit.id === prior.id)?.completedAt, prior.completedAt);
  assert.equal(await page.getByRole('heading', { name: '论文分析', exact: true }).isVisible(), true);
  console.log('PASS: 就绪停留、补选保存失败挡导航、重试自动局部处理并保留其他单元');
  await page.getByRole('button', { name: '下一步：图源核对', exact: true }).click();
  await page.getByRole('button', { name: '确认切分', exact: true }).waitFor();
  assert.equal((await runtime(page)).project.lastOpenedStep, 'figure-review');
  await page.getByRole('button', { name: '1 论文分析', exact: true }).click();
  await page.getByRole('heading', { name: '论文分析', exact: true }).waitFor();
  assert.equal((await runtime(page)).project.lastOpenedStep, 'paper-analysis');
  assert.equal((await runtime(page)).progress.ready, true);
  await page.screenshot({ path: `${output}/m15-fixed-analysis.png` });
  await writeFile(
    `${output}/m15-fixed-browser.json`,
    JSON.stringify(
      { pages: completed.paper.pages.length, units: completed.paper.analysisUnits.length, calls, pageErrors: errors },
      null,
      2,
    ),
  );
  if (process.env.SMARTJC_M19_CHAIN === '1') await (await import('./m19-chain.mjs')).finishM19Chain(page, output);
  assert.deepEqual(errors, []);
  console.log('PASS: 手动下一步与浏览回退保存位置，正式分析 UI 无 pageerror');
} finally {
  releaseModels();
  await browser.close();
}
