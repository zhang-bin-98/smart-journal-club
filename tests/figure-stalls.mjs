import { responsesEvent, decodeResponseRequest } from './responses-fixture.ts';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

function sse(result) {
  return responsesEvent({
    tool_calls: [{ function: { name: 'submit_result', arguments: JSON.stringify({ result }) } }],
  });
}

/** 只扩充用户报错论文的图页阶段，不复制编辑、导出或 PWA 主链。全程固定响应。 */
export async function checkFigureStalls(page, base) {
  page.setDefaultTimeout(90000);
  const name = (await readdir('test-fixtures/papers')).find(
    (file) => file.includes('Longitudinal dynamics') && file.endsWith('.pdf'),
  );
  if (!name) {
    console.log('SKIP: aging PDF 定向回归，需要本地 Longitudinal dynamics 论文；其他主链继续');
    return;
  }
  let mode = 'hold';
  let held;
  let releaseRepair;
  const calls = [];
  const routePattern = 'https://api.deepseek.com/responses';
  await page.route(routePattern, async (route) => {
    const request = decodeResponseRequest(route.request().postDataJSON());
    const content = request.messages.find((message) => message.role === 'user').content;
    const data = JSON.parse(typeof content === 'string' ? content : content.find((item) => item.type === 'text').text);
    calls.push({ page: data.pageNumber, repair: !!data.diagnostics });
    if (mode === 'hold') {
      held = route;
      return;
    }
    let result;
    if (data.pageNumber) {
      result = {
        figures: [
          {
            label: `Figure ${[3, 4, 5, 7, 8, 9].indexOf(data.pageNumber) + 1}`,
            caption: '固定测试图注',
            description: '固定测试描述',
            panels: [],
            bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 },
          },
        ],
      };
      if (!data.diagnostics) delete result.figures[0].bbox;
    } else {
      result = await page.evaluate(
        async (paper) => (await import('/tests/analysis-contracts.ts')).understanding(paper),
        data.paper,
      );
    }
    const reply = () => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(result) });
    if (data.pageNumber === 3 && data.diagnostics) {
      releaseRepair = reply;
      return;
    }
    await reply();
  });
  try {
    await page.goto(base);
    await page.evaluate(async () => {
      const { settingsService } = await import('/src/app/composition.ts');
      const { DEFAULT_SETTINGS } = await import('/src/app/model.ts');
      await settingsService.save({
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-flash',
        apiKey: 'fixed-test-key',
      });
    });
    await page.reload();
    await page.getByLabel('选择论文 PDF').setInputFiles(resolve('test-fixtures/papers', name));
    await page.waitForURL(/project/);
    const first = page.waitForRequest(routePattern);
    await page.getByRole('button', { name: '分析论文', exact: true }).click();
    await first;
    await page.getByRole('status').filter({ hasText: 'PDF 第 3 页，已完成 0/6' }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 3000 });
    await held.abort().catch(() => {});
    assert.equal(calls.length, 1);
    const snapshot = () =>
      page.evaluate(async () => {
        const id = location.hash.split('/project/')[1];
        const data = await (await import('/src/modules/project/projectRepository.ts')).loadProject(id);
        return {
          checkpoint: data.project.checkpoint,
          pages: data.paper.pages.length,
          figures: data.paper.figures.length,
        };
      });
    assert.deepEqual(await snapshot(), { checkpoint: 'pdf-parsed', pages: 18, figures: 0 });

    // 提前触发原生超时信号，不消耗 3 分钟或模型额度；SDK 和应用仍走真实取消路径。
    await page.evaluate(() => {
      window.__originalTimeout = AbortSignal.timeout;
      AbortSignal.timeout = () => {
        window.__figureTimeout = new AbortController();
        return window.__figureTimeout.signal;
      };
    });
    const second = page.waitForRequest(routePattern);
    await page.getByRole('button', { name: '重试当前步骤', exact: true }).click();
    await second;
    await page.evaluate(() => window.__figureTimeout.abort(new DOMException('fixed timeout', 'TimeoutError')));
    await page.getByRole('alert').filter({ hasText: '模型响应超时' }).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden' });
    await held.abort().catch(() => {});
    assert.equal(calls.length, 2);
    assert.deepEqual(await snapshot(), { checkpoint: 'pdf-parsed', pages: 18, figures: 0 });
    await page.evaluate(() => {
      AbortSignal.timeout = window.__originalTimeout;
    });

    mode = 'success';
    const repair = page.waitForRequest(
      (request) => request.url() === routePattern && request.postData().includes('diagnostics'),
    );
    await page.getByRole('button', { name: '重试当前步骤', exact: true }).click();
    await repair;
    await page.getByRole('status').filter({ hasText: '修复格式（仅一次）' }).waitFor();
    assert.ok(releaseRepair);
    await releaseRepair();
    await page.getByRole('button', { name: '生成学术大纲', exact: true }).waitFor({ timeout: 90000 });
    assert.deepEqual(
      calls.slice(2).map((call) => call.page),
      [3, 3, 4, 4, 5, 5, 7, 7, 8, 8, 9, 9, undefined],
    );
    assert.equal(calls.filter((call) => call.repair).length, 6);
    assert.deepEqual(await snapshot(), { checkpoint: 'paper-ready', pages: 18, figures: 6 });
    console.log(
      'PASS: aging PDF 18 pages/6 candidates/cancel/timeout/atomic checkpoint/12 finite figure calls/progress/retry',
    );
  } finally {
    await page.evaluate(() => {
      if (window.__originalTimeout) AbortSignal.timeout = window.__originalTimeout;
    });
    await page.unroute(routePattern);
  }
}
