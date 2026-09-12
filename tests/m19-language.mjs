import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'mechanism-modt-cdifficile';
const prefix = 'output/playwright/m19-' + name;
const prior = JSON.parse(await readFile(prefix + '-speech-edited.json', 'utf8')).result;
const pdf = (await readFile('test-fixtures/papers/' + name + '.pdf')).toString('base64');
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
const started = Date.now();
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  await page.exposeFunction('m19Stage', (s) => console.log(s));
  const result = await page.evaluate(
    async ({ prior, pdf, name }) => {
      const app = await import('/src/app/composition.ts');
      const { prompts } = await import('/src/infrastructure/llm/prompts.ts');
      const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
      const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
      const { organizeSpeech } = await import('/src/app/workflows/organizeSpeech.ts');
      const { contentOf } = await import('/src/modules/presentation/content/index.ts');
      const { settings } = await app.settingsService.load();
      const controller = new AbortController();
      const calls = [],
        original = app.modelRequests.requestJson;
      app.modelRequests.requestJson = async (input) => {
        const started = Date.now();
        const result = await original(input);
        calls.push({ stage: input.stage, durationMs: Date.now() - started, result });
        return result;
      };
      const content = await organizeSpeech({
        content: contentOf(prior.record.plan),
        paper: prior.paper,
        settings,
        requests: app.modelRequests,
        prompts,
        signal: controller.signal,
        assertActive() {},
        onStage: window.m19Stage,
      });
      if (JSON.stringify(content.speech) !== JSON.stringify(prior.record.plan.speech))
        throw Error('Language organization changed reviewed speech');
      const created = await createProject({
        primary: new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], name + '.pdf'),
        name: 'M19 mechanism language review',
      });
      const paper = {
        ...prior.paper,
        id: created.paper.id,
        projectId: created.project.id,
        documents: prior.paper.documents.map((d, i) => ({ ...d, pdfAssetId: created.paper.documents[i].pdfAssetId })),
      };
      const record = {
        ...prior.record,
        projectId: created.project.id,
        plan: { ...prior.record.plan, ...content, paperId: paper.id },
        base: { ...prior.record.base, paperId: paper.id },
      };
      const project = {
        ...created.project,
        preferences: prior.project.preferences,
        checkpoint: 'outline-ready',
        lastOpenedStep: 'outline-speech',
      };
      await transaction(['projects', 'papers', 'plans'], 'readwrite', async (tx) => {
        tx.objectStore('projects').put(project, project.id);
        tx.objectStore('papers').put(paper, paper.id);
        tx.objectStore('plans').put(record, project.id);
      });
      await app.slidesService.generate({
        projectId: project.id,
        settings,
        signal: controller.signal,
        assertActive() {},
        onStage: window.m19Stage,
      });
      const saved = await app.slidesStore.open(project.id);
      return { project: saved.project, paper: saved.paper, record: saved.record, deck: saved.current, calls };
    },
    { prior, pdf, name },
  );
  await writeFile(prefix + '-language.json', JSON.stringify({ durationMs: Date.now() - started, result }, null, 2));
  console.log('PASS: reorganized and replanned in saved speech language; export audited separately');
} finally {
  await browser.close();
}
