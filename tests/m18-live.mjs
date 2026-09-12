import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { responsesEvent } from './responses-fixture.ts';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5178/';
const prior = JSON.parse(await readFile('output/playwright/m17-real-speech.json', 'utf8')).result;
const pdf = (await readFile('test-fixtures/papers/omics-torc1-proteomics.pdf')).toString('base64');
const env = await readFile('.env', 'utf8');
const apiKey = env
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey, 'Existing model configuration is required');
const cached =
  process.env.SMARTJC_REUSE_SLIDES === '1'
    ? JSON.parse(await readFile('output/playwright/m18-real-calls.json', 'utf8'))
    : [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('output/playwright', { recursive: true });
const calls = [];
const pending = [];
const hash = (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.routeWebSocket('**', (socket) => socket.close());
  if (cached.length)
    await page.route('https://api.deepseek.com/**', async (route) => {
      const body = route.request().postDataJSON();
      const input = JSON.parse(
        body.input.find((m) => m.role === 'user').content.find((c) => c.type === 'input_text').text,
      );
      const reusable = cached.find((call) => call.inputHash === hash(input) && call.result && !input.diagnostics);
      if (!reusable) return route.continue();
      calls.push({ ...reusable, reused: true });
      console.log(`M18:reused real response ${input.section?.title}`);
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: responsesEvent({
          tool_calls: [
            {
              id: 'saved-real',
              function: { name: 'submit_result', arguments: JSON.stringify({ result: reusable.result }) },
            },
          ],
        }),
      });
    });
  page.on('response', (response) => {
    if (!response.url().startsWith('https://api.deepseek.com/')) return;
    pending.push(
      (async () => {
        try {
          const body = response.request().postDataJSON();
          const input = JSON.parse(
            body.input.find((m) => m.role === 'user').content.find((c) => c.type === 'input_text').text,
          );
          const events = (await response.text())
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .flatMap((line) => {
              try {
                return [JSON.parse(line.slice(6))];
              } catch {
                return [];
              }
            });
          const complete = events.find(
            (event) => event.type === 'response.completed' || event.type === 'response.incomplete',
          );
          const output = complete?.response?.output?.find((item) => item.type === 'function_call');
          const parsed = output ? JSON.parse(output.arguments) : undefined;
          if (!calls.some((call) => call.inputHash === hash(input) && call.reused))
            calls.push({
              section: input.section?.title,
              inputHash: hash(input),
              repair: !!input.diagnostics,
              status: response.status(),
              result: parsed?.result,
              usage: complete?.response?.usage,
            });
          await writeFile('output/playwright/m18-real-calls.json', JSON.stringify(calls, null, 2));
          console.log(`M18:received ${input.section?.title} repair=${!!input.diagnostics}`);
        } catch {
          console.log('M18:response ended without complete output');
        }
      })(),
    );
  });
  await page.goto(base);
  const id = await page.evaluate(
    async ({ prior, pdf, apiKey }) => {
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const { speechStore } = await import('/src/app/composition.ts');
      const { settingsService } = await import('/src/app/composition.ts');
      await settingsService.save({
        protocol: 'responses',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-flash',
        reasoningEffort: 'high',
        apiKey,
      });
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'omics-torc1-proteomics.pdf', {
          type: 'application/pdf',
        }),
        preferences: prior.project.preferences,
      });
      const paper = {
        ...prior.paper,
        id: created.paper.id,
        projectId: created.project.id,
        documents: prior.paper.documents.map((document, index) => ({
          ...document,
          pdfAssetId: created.paper.documents[index].pdfAssetId,
        })),
      };
      await transaction(['papers', 'projects'], 'readwrite', async (tx) => {
        tx.objectStore('papers').put(paper, paper.id);
        tx.objectStore('projects').put(
          { ...created.project, lastOpenedStep: 'outline-speech', checkpoint: 'outline-ready' },
          created.project.id,
        );
      });
      const data = await speechStore.open(created.project.id);
      await speechStore.saveGenerated({
        record: {
          ...prior.record,
          projectId: created.project.id,
          base: data.base,
          mode: 'initial',
          stage: 'outline-ready',
          plan: {
            ...prior.record.plan,
            id: crypto.randomUUID(),
            paperId: paper.id,
            paperRevision: paper.revision,
            slides: [],
            status: 'draft',
          },
        },
        expectedPlan: data.planKey,
        signal: new AbortController().signal,
        assertActive() {},
      });
      return created.project.id;
    },
    { prior, pdf, apiKey },
  );
  await page.goto(`${base}#/project/${id}`);
  await page.reload();
  const start = Date.now();
  await page.getByRole('button', { name: '下一步：生成幻灯片', exact: true }).click();
  let lastStatus = '';
  for (let tick = 0; tick < 750; tick++) {
    const status = await page.evaluate(async (id) => {
      const state = await (await import('/src/app/composition.ts')).slidesStore.open(id);
      return {
        ready: !!state.current,
        error: [...document.querySelectorAll('[role="alert"]')]
          .map((node) => node.textContent.trim())
          .filter(Boolean)
          .join('；'),
        status: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent.trim()).join('；'),
      };
    }, id);
    if (status.status !== lastStatus) {
      console.log(status.status);
      lastStatus = status.status;
    }
    if (status.ready || (tick > 3 && status.error)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const state = await page.evaluate(
    async (id) => await (await import('/src/app/composition.ts')).slidesStore.open(id),
    id,
  );
  const alert = await page.locator('[role="alert"]').allTextContents();
  await writeFile(
    'output/playwright/m18-real-presentation.json',
    JSON.stringify(
      {
        durationMs: Date.now() - start,
        alert,
        result: { project: state.project, paper: state.paper, deck: state.current, record: state.record },
      },
      null,
      2,
    ),
  );
  await Promise.all(pending);
  await page.screenshot({ path: 'output/playwright/m18-real-workspace.png' });
  assert.ok(state.current, `Real generation incomplete: ${alert.join('；')}`);
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs('output/playwright/m18-real.pptx');
  console.log(`M18:real generation and export complete; slides=${state.current.slides.length}`);
} catch (error) {
  if (page) await page.screenshot({ path: 'output/playwright/m18-real-failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
