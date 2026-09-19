import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const samples = {
  mechanism: { name: 'mechanism-modt-cdifficile', pages: 32 },
  clinical: { name: 'clinical-vrc07-phase1-trial', pages: 25 },
  aging: {
    name: 'aging-longitudinal-multiomics',
    file: 'El-Sayed Moustafa 等 - 2026 - Longitudinal dynamics of gene expression and metabolomics in an aging population cohort.pdf',
    pages: 18,
    figurePages: [3, 4, 5, 7, 8, 9],
    sha256: '6dee0662e7605cb70daa799f9ef080993f334c1aa551f7423d8bdc714ae0a95e',
  },
};
const sample = samples[process.env.SMARTJC_PUBLIC_SAMPLE];
assert.ok(sample, 'Select mechanism, clinical or aging through SMARTJC_PUBLIC_SAMPLE');
const capacityCheck = process.env.SMARTJC_CAPACITY_CHECK === '1';
if (capacityCheck) assert.equal(process.env.SMARTJC_PUBLIC_SAMPLE, 'aging');
const name = sample.name + (capacityCheck ? '-capacity' : '');
const pdfPath = resolve('test-fixtures/papers', sample.file ?? `${name}.pdf`);
if (sample.sha256)
  assert.equal(
    createHash('sha256')
      .update(await readFile(pdfPath))
      .digest('hex'),
    sample.sha256,
  );
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/';
const output = `output/playwright/m19-${name}`;
await mkdir('output/playwright', { recursive: true });
const env = await readFile('.env', 'utf8');
const apiKey = env
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey, 'Existing validation configuration is required');
const browser = await chromium.launchPersistentContext(join(tmpdir(), `smartjc-m19-${name}`), {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const calls = await readFile(`${output}-calls.json`, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
const pending = [];
const initialCallCount = calls.length;
let reopenedReady = false;
let writingCalls = Promise.resolve();
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  const errors = [];
  const starts = new WeakMap();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => starts.set(request, Date.now()));
  page.on('response', (response) => {
    if (!response.url().startsWith('https://api.deepseek.com/') || response.request().method() !== 'POST') return;
    pending.push(
      (async () => {
        try {
          const payload = response.request().postDataJSON();
          const user = payload.input?.find((m) => m.role === 'user');
          let input = {};
          try {
            input = JSON.parse(user?.content?.find((c) => c.type === 'input_text')?.text || '{}');
          } catch {}
          const events = (await response.text()).split(/\r?\n/).filter((line) => line.startsWith('data: '));
          const completed = events
            .flatMap((line) => {
              try {
                return [JSON.parse(line.slice(6))];
              } catch {
                return [];
              }
            })
            .find((event) => event.type === 'response.completed' || event.type === 'response.incomplete');
          const outputs = completed?.response?.output
            ?.filter((item) => item.type === 'function_call')
            .map((item) => {
              try {
                return JSON.parse(item.arguments);
              } catch {
                return { invalidJson: true };
              }
            });
          let stage = 'understand-summary';
          if (input.blocks) stage = 'understand-page';
          if (input.imageRegions) stage = 'figures';
          if (input.figureLabel) stage = 'figure-local';
          const diagnostic = {
            stage,
            pageNumber: input.pageNumber,
            figureLabel: input.figureLabel,
            part: input.sequence?.part,
            repair:
              !!input.diagnostics ||
              JSON.stringify([payload.instructions, payload.input]).includes('这是唯一一次格式/引用修复'),
            status: response.status(),
            resultStatus: completed?.response?.status,
            reason: completed?.response?.incomplete_details?.reason,
            maxOutputTokens: payload.max_output_tokens,
            reasoningEffort: payload.reasoning?.effort ?? 'default',
            durationMs: Date.now() - starts.get(response.request()),
            usage: completed?.response?.usage,
          };
          calls.push({ ...diagnostic, outputs });
          const snapshot = JSON.stringify(calls, null, 2);
          writingCalls = writingCalls.then(() => writeFile(`${output}-calls.json`, snapshot));
          await writingCalls;
          console.log('MODEL', JSON.stringify(diagnostic));
        } catch {
          console.log('Response telemetry unavailable; completion is determined from saved analysis units');
        }
      })(),
    );
  });
  await page.goto(base);
  const existing = await page.evaluate(async (name) => {
    const { projectsService } = await import('/src/app/composition.ts');
    return (await projectsService.listManagedProjects()).find((p) => p.name === `M19 ${name}`);
  }, name);
  if (!existing) {
    await page.getByRole('button', { name: /^模型设置/ }).click();
    const settings = page.getByRole('main', { name: '模型配置', exact: true });
    await settings.getByLabel('Base URL', { exact: true }).fill('https://api.deepseek.com');
    await settings.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
    await settings.getByLabel('API Key', { exact: true }).fill(apiKey);
    await settings.getByLabel('思考强度', { exact: true }).selectOption(capacityCheck ? 'max' : 'high');
    if (capacityCheck) {
      await settings.getByLabel('上下文窗口（Token）', { exact: true }).fill('1000000');
      await settings.getByLabel('最大输出 Token', { exact: true }).fill('384000');
      await settings.getByLabel('模型请求并发数', { exact: true }).fill('5');
    }
    await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('选择主论文 PDF', { exact: true }).setInputFiles(pdfPath);
    await page.getByLabel('项目名称', { exact: true }).fill(`M19 ${name}`);
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
  } else {
    await page
      .getByRole('row')
      .filter({ hasText: `M19 ${name}` })
      .getByRole('button', { name: '打开', exact: true })
      .click();
    const ready = await page.evaluate(async (id) => {
      const { openProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { getAnalysisProgress } = await import('/src/modules/paper/analysisUnits.ts');
      return getAnalysisProgress((await openProject(id)).paper).ready;
    }, existing.id);
    reopenedReady = ready;
    if (!ready) await page.getByRole('button', { name: /^(开始分析|继续分析|重试未完成部分)$/ }).click();
  }
  await page.waitForURL(/#\/project\//);
  const id = decodeURIComponent(page.url().split('#/project/')[1]);
  const started = Date.now();
  let last = '';
  for (let tick = 0; tick < 720; tick++) {
    const state = await page.evaluate(async (id) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))?.name;
      const { analysisService } = await import(url ?? '/src/app/composition.ts');
      const s = analysisService.session(id).snapshot();
      const { openProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { getAnalysisProgress } = await import('/src/modules/paper/analysisUnits.ts');
      const progress = getAnalysisProgress((await openProject(id)).paper);
      return { status: s.status, stage: s.stage, pageNumber: s.pageNumber, error: s.error, progress };
    }, id);
    const summary = JSON.stringify(state);
    if (summary !== last) {
      console.log(summary);
      last = summary;
    }
    if (state.status === 'failed' || state.progress?.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const result = await page.evaluate(async (id) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => /\/src\/app\/composition\.ts(?:\?|$)/.test(entry.name))?.name;
    const { analysisService } = await import(url ?? '/src/app/composition.ts');
    const session = analysisService.session(id);
    const s = session.snapshot();
    const { openProject } = await import('/src/infrastructure/persistence/projectStore.ts');
    const { getAnalysisProgress } = await import('/src/modules/paper/analysisUnits.ts');
    const data = await openProject(id);
    return {
      project: data.project,
      paper: data.paper,
      status: s.status,
      stage: s.stage,
      pageNumber: s.pageNumber,
      error: s.error,
      progress: getAnalysisProgress(data.paper),
    };
  }, id);
  await Promise.all(pending);
  if (reopenedReady) assert.equal(calls.length, initialCallCount, '重开已就绪项目不应发起模型调用');
  await writeFile(`${output}-analysis.json`, JSON.stringify({ durationMs: Date.now() - started, ...result }, null, 2));
  await page.screenshot({ path: `${output}-analysis.png` });
  assert.equal(result.paper.pages.length, sample.pages, '全部 PDF 页面应完成本地提取');
  assert.deepEqual(errors, [], '浏览器异常');
  assert.equal(result.progress?.ready, true, result.error);
  assert.ok(result.paper.claims.length > 0);
  if (sample.figurePages) {
    for (const [index, pageNumber] of sample.figurePages.entries()) {
      const figures = result.paper.figures.filter((figure) => Number(figure.label.match(/\d+/)?.[0]) === index + 1);
      assert.equal(figures.length, 1, `Figure ${index + 1} 应完整且仅登记一次`);
      const source = result.paper.sources.find((source) => source.id === figures[0].regions[0].sourceId);
      assert.equal(source?.pageNumber, pageNumber, `Figure ${index + 1} 的文件内页码`);
    }
    assert.equal(
      result.paper.sources.some((source) => source.pageNumber === 18 && source.kind === 'figure'),
      false,
      '末页出版信息不能作为科研 Figure 保存',
    );
  }
  console.log('PASS: public sample analysis saved; scientific review pending');
} finally {
  await browser.close();
}
