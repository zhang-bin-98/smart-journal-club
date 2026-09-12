import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const names = { mechanism: 'mechanism-modt-cdifficile', clinical: 'clinical-vrc07-phase1-trial' };
const name = names[process.env.SMARTJC_PUBLIC_SAMPLE];
assert.ok(name, 'Select one of the two existing public M19 samples');
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
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
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
          calls.push({
            pageNumber: input.pageNumber,
            part: input.sequence?.part,
            repair: !!input.diagnostics,
            status: response.status(),
            resultStatus: completed?.response?.status,
            outputs,
            usage: completed?.response?.usage,
          });
          await writeFile(`${output}-calls.json`, JSON.stringify(calls, null, 2));
        } catch {
          console.log('Response ended without complete result');
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
    await settings.getByLabel('思考强度', { exact: true }).selectOption('high');
    await settings.getByRole('button', { name: '保存并返回', exact: true }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('选择主论文 PDF', { exact: true }).setInputFiles(resolve(`test-fixtures/papers/${name}.pdf`));
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
      s.progress = getAnalysisProgress((await openProject(id)).paper);
      return { status: s.status, stage: s.stage, pageNumber: s.pageNumber, error: s.error, progress: s.progress };
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
    await session.load();
    const s = session.snapshot();
    return { project: s.data?.project, paper: s.data?.paper, status: s.status, error: s.error, progress: s.progress };
  }, id);
  await Promise.all(pending);
  await writeFile(`${output}-analysis.json`, JSON.stringify({ durationMs: Date.now() - started, ...result }, null, 2));
  await page.screenshot({ path: `${output}-analysis.png` });
  assert.equal(result.progress?.ready, true, result.error);
  assert.ok(result.paper.claims.length > 0);
  console.log('PASS: public sample analysis saved; scientific review pending');
} finally {
  await browser.close();
}
