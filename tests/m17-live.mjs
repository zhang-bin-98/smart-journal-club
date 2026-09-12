import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/';
const reusable =
  process.env.SMARTJC_REUSE_SPEECH === '1'
    ? JSON.parse(await readFile('output/playwright/m17-real-batches.json', 'utf8')).filter(
        (call) => call.part <= 11 && call.part !== 5,
      )
    : [];
const env = await readFile('.env', 'utf8');
const apiKey = env
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey);
const prior = JSON.parse(await readFile('output/playwright/m15-real-analysis.json', 'utf8')).paper;
const pdf = (await readFile('test-fixtures/papers/omics-torc1-proteomics.pdf')).toString('base64');
const manual = JSON.parse(await readFile('output/playwright/m16-risk/omics-torc1-proteomics-manual.json', 'utf8'));
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.routeWebSocket('**', (socket) => socket.close());
  const calls = [];
  const pendingResponses = [];
  page.on('response', (response) => {
    if (!response.url().startsWith('https://api.deepseek.com/')) return;
    const work = (async () => {
      try {
        const payload = response.request().postDataJSON();
        const user = payload.input?.find((message) => message.role === 'user');
        const text = user?.content?.find((content) => content.type === 'input_text')?.text;
        const input = text ? JSON.parse(text) : {};
        const events = (await response.text()).split('\n').filter((line) => line.startsWith('data: '));
        const completed = events
          .map((line) => {
            try {
              return JSON.parse(line.slice(6));
            } catch {
              return {};
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
          part: input.sequence?.part,
          repair: !!input.diagnostics,
          diagnostics: input.diagnostics,
          status: response.status(),
          outputs,
          usage: completed?.response?.usage,
        });
        await writeFile('output/playwright/m17-real-calls.json', JSON.stringify(calls, null, 2));
        console.log(`M17:received response ${input.sequence?.part} repair=${!!input.diagnostics}`);
      } catch {
        /* A cancelled response has no complete result to inspect. */
      }
    })();
    pendingResponses.push(work);
  });
  page.on('console', (message) => {
    if (message.text().startsWith('M17:')) console.log(message.text());
  });
  await page.goto(base);
  const id = await page.evaluate(
    async ({ prior, pdf, apiKey, manual }) => {
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const { settingsService } = await import('/src/app/composition.ts');
      const settings = {
        protocol: 'responses',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-flash',
        reasoningEffort: 'high',
        apiKey,
      };
      await settingsService.save(settings);
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'omics-torc1-proteomics.pdf', {
          type: 'application/pdf',
        }),
        preferences: { instruction: '', language: 'zh', strategyId: 'omics' },
      });
      const paper = {
        ...prior,
        id: created.paper.id,
        projectId: created.project.id,
        documents: [{ ...prior.documents[0], pdfAssetId: created.paper.documents[0].pdfAssetId }],
      };
      // 复用 M16 同篇 Fig 3 的实际人工边框；其余科学底稿沿用 M15 原稿。
      const figure = paper.figures.find((f) => /(?:Fig(?:ure)?\.?\s*)?3$/i.test(f.label ?? ''));
      if (figure) {
        const region = figure.regions[0];
        const target = paper.sources.find((s) => s.id === region.sourceId);
        if (target) target.bbox = manual.sources.find((s) => s.id === 'region-source').bbox;
        for (const panel of region.panels) {
          const corrected = manual.sources.find((s) => s.id === `${panel.label}-source`);
          const source = paper.sources.find((s) => s.id === panel.sourceId);
          if (source && corrected) source.bbox = corrected.bbox;
        }
      }
      paper.figureReview = {
        ...paper.figureReview,
        confirmedRevision: paper.figureReview.revision,
        confirmedAt: Date.now(),
      };
      await transaction(['papers', 'projects'], 'readwrite', async (tx) => {
        tx.objectStore('papers').put(paper, paper.id);
        tx.objectStore('projects').put(
          { ...created.project, checkpoint: 'paper-ready', lastOpenedStep: 'outline-speech' },
          created.project.id,
        );
      });
      return created.project.id;
    },
    { prior, pdf, apiKey, manual },
  );
  await page.goto(`${base}#/project/${id}`);
  await page.reload();
  await page.getByRole('button', { name: '生成讲稿', exact: true }).waitFor();
  const batchSizes = await page.evaluate(async (id) => {
    const { speechBatches } = await import('/src/app/presentation/speechBatches.ts');
    const { speechContext } = await import('/src/app/presentation/speechContext.ts');
    const { speechStore } = await import('/src/app/composition.ts');
    const { paper } = await speechStore.open(id);
    return speechBatches(paper).map((batch) => ({
      claims: batch.claims.length,
      chars: JSON.stringify(speechContext(batch, paper).context).length,
    }));
  }, id);
  console.log(JSON.stringify({ batchSizes }));
  const reusedParts = await page.evaluate(async (reusable) => {
    const { modelRequests } = await import('/src/app/composition.ts');
    const original = modelRequests.requestJson;
    window.m17ReusedParts = [];
    modelRequests.requestJson = async (input) => {
      const part = input.data.sequence?.part;
      const recorded = reusable.filter((call) => call.part === part).at(-1);
      if (input.stage === 'speech' && recorded) {
        const result = input.schema.parse(recorded.outputs[0].result);
        window.m17ReusedParts.push(part);
        console.log(`M17:reused recorded live response ${part}`);
        return result;
      }
      return original(input);
    };
    return reusable.map((call) => call.part).filter((part, index, all) => all.indexOf(part) === index);
  }, reusable);
  if (reusable.length)
    await page.route('https://api.deepseek.com/**', async (route) => {
      const payload = route.request().postDataJSON();
      const user = payload?.input?.find((message) => message.role === 'user');
      const text = user?.content?.find((content) => content.type === 'input_text')?.text;
      const input = text ? JSON.parse(text) : {};
      if (reusedParts.includes(input.sequence?.part)) await route.abort();
      else await route.continue();
    });
  const started = Date.now();
  await page.getByRole('button', { name: '生成讲稿', exact: true }).click();
  await page.waitForFunction(
    () => {
      const stage = document.querySelector('nav[aria-label="项目步骤"]')?.innerText;
      if (stage !== window.m17LastStage) {
        console.log(`M17:${stage}`);
        window.m17LastStage = stage;
      }
      return document.querySelector('[aria-label="讲稿正文"]') || document.querySelector('[role="alert"]');
    },
    null,
    { timeout: 1800000 },
  );
  await Promise.all(pendingResponses);
  const result = await page.evaluate(
    async (id) => await (await import('/src/app/composition.ts')).speechStore.open(id),
    id,
  );
  const alert = await page.getByRole('alert').allTextContents();
  const actualReused = await page.evaluate(() => window.m17ReusedParts);
  assert.deepEqual(actualReused, reusedParts, 'Recorded live responses were not reused as intended');
  const record = { durationMs: Date.now() - started, alert, result, reusedParts: actualReused };
  await writeFile('output/playwright/m17-real-speech.json', JSON.stringify(record, null, 2));
  await page.screenshot({ path: 'output/playwright/m17-real-speech.png' });
  assert.ok(result.target, alert.join(' '));
  console.log(
    JSON.stringify({
      durationMs: record.durationMs,
      sections: result.target.content.sections.length,
      paragraphs: result.target.content.speechParagraphs.length,
      claims: result.paper.claims.length,
      speech: result.target.content.speech.length,
    }),
  );
} finally {
  await browser.close();
}
