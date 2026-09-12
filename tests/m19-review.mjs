import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const names = { mechanism: 'mechanism-modt-cdifficile', clinical: 'clinical-vrc07-phase1-trial' };
const name = names[process.env.SMARTJC_PUBLIC_SAMPLE];
const stage = process.env.SMARTJC_REVIEW_STAGE || 'review';
assert.ok(name && ['review', 'speech', 'slides', 'export'].includes(stage));
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/';
const prefix = 'output/playwright/m19-' + name;
await mkdir(prefix + '-figures', { recursive: true });
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const page = browser.pages()[0] || (await browser.newPage());
const calls = [];
const pending = [];
const started = Date.now();
try {
  await page.routeWebSocket('**', (socket) => socket.close());
  page.on('response', (response) => {
    if (!response.url().startsWith('https://api.deepseek.com/') || response.request().method() !== 'POST') return;
    pending.push(
      (async () => {
        try {
          const body = response.request().postDataJSON();
          const user = body.input?.find((m) => m.role === 'user');
          const input = JSON.parse(user?.content?.find((c) => c.type === 'input_text')?.text || '{}');
          const events = (await response.text())
            .split(/\r?\n/)
            .filter((s) => s.startsWith('data: '))
            .flatMap((s) => {
              try {
                return [JSON.parse(s.slice(6))];
              } catch {
                return [];
              }
            });
          const complete = events.find((e) => e.type === 'response.completed' || e.type === 'response.incomplete');
          calls.push({
            at: Date.now(),
            stage,
            section: input.section?.title,
            part: input.sequence?.part,
            repair: !!input.diagnostics,
            diagnostics: input.diagnostics,
            status: response.status(),
            resultStatus: complete?.response?.status,
            incomplete: complete?.response?.incomplete_details,
            usage: complete?.response?.usage,
            outputs: complete?.response?.output
              ?.filter((o) => o.type === 'function_call')
              .map((o) => {
                try {
                  return JSON.parse(o.arguments);
                } catch {
                  return { invalidJson: true };
                }
              }),
          });
          await writeFile(prefix + '-' + stage + '-calls.json', JSON.stringify(calls, null, 2));
        } catch {
          console.log('Response ended without a complete result');
        }
      })(),
    );
  });
  await page.goto(base);
  const project = await page.evaluate(
    async (name) =>
      (await (await import('/src/app/composition.ts')).projectsService.listManagedProjects()).find(
        (p) => p.name === 'M19 ' + name,
      ),
    name,
  );
  assert.ok(project, 'Use the existing analyzed sample');
  const id = project.id;
  await page.goto(base + '#/project/' + id);
  await page.waitForFunction(() => !!document.querySelector('[aria-label="项目步骤"]'));
  const read = () =>
    page.evaluate(async (id) => {
      const state = await (await import('/src/app/composition.ts')).slidesStore.open(id);
      return { project: state.project, paper: state.workingPaper, record: state.record, deck: state.current };
    }, id);
  if (stage === 'review') {
    const data = await read();
    await writeFile(prefix + '-review.json', JSON.stringify(data, null, 2));
    const pages = [
      ...new Set(
        data.paper.figures.flatMap((f) =>
          f.regions.map((r) => data.paper.sources.find((s) => s.id === r.sourceId).pageNumber),
        ),
      ),
    ];
    for (const number of pages) {
      const image = await page.evaluate(
        async ({ id, number }) => {
          const { openProject } = await import('/src/infrastructure/persistence/projectStore.ts');
          const { createFigureResources } = await import('/src/infrastructure/pdf/figureResource.ts');
          const data = await openProject(id);
          const resources = createFigureResources(data);
          const bitmap = await resources.acquire(data.paper.documents[0].id, number, new AbortController().signal);
          const canvas = document.createElement('canvas');
          canvas.width = 1200;
          canvas.height = Math.round((bitmap.canvas.height / bitmap.canvas.width) * 1200);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap.canvas, 0, 0, canvas.width, canvas.height);
          ctx.lineWidth = 2;
          ctx.font = 'bold 18px Arial';
          for (const figure of data.paper.figures)
            for (const region of figure.regions) {
              const source = data.paper.sources.find((s) => s.id === region.sourceId);
              if (source.pageNumber !== number) continue;
              for (const entry of [
                { source, label: figure.label, color: '#e60000' },
                ...region.panels.map((p) => ({
                  source: data.paper.sources.find((s) => s.id === p.sourceId),
                  label: p.label,
                  color: '#006fff',
                })),
              ]) {
                const b = entry.source.bbox;
                ctx.strokeStyle = entry.color;
                ctx.fillStyle = entry.color;
                ctx.strokeRect(
                  b.x * canvas.width,
                  b.y * canvas.height,
                  b.width * canvas.width,
                  b.height * canvas.height,
                );
                ctx.fillText(entry.label ?? '', b.x * canvas.width + 2, b.y * canvas.height + 18);
              }
            }
          bitmap.release();
          resources.dispose();
          return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
        },
        { id, number },
      );
      await writeFile(prefix + '-figures/page-' + number + '.jpg', Buffer.from(image, 'base64'));
    }
    console.log(
      JSON.stringify({
        pages: data.paper.pages.length,
        figures: data.paper.figures.length,
        claims: data.paper.claims.length,
        reviewPages: pages,
      }),
    );
  } else {
    let data = await read();
    if (stage === 'speech' && !data.record) {
      if (await page.getByRole('button', { name: '2 图源核对', exact: true }).count())
        await page.getByRole('button', { name: '2 图源核对', exact: true }).click();
      await page.getByRole('button', { name: /^(确认切分|切分已确认)$/ }).waitFor();
      if (await page.getByRole('button', { name: '确认切分', exact: true }).count())
        await page.getByRole('button', { name: '确认切分', exact: true }).click();
      await page.getByRole('button', { name: '生成大纲与讲稿', exact: true }).click();
    }
    if (stage === 'slides' && !data.deck) {
      if (await page.getByRole('button', { name: '3 大纲与演讲稿', exact: true }).count())
        await page.getByRole('button', { name: '3 大纲与演讲稿', exact: true }).click();
      await page.getByRole('button', { name: '下一步：生成幻灯片', exact: true }).click();
    }
    let last = '';
    for (let tick = 0; tick < 1200; tick++) {
      data = await read();
      const status = await page.locator('[role="status"]').allTextContents();
      const error = await page.locator('[role="alert"]').allTextContents();
      const summary = JSON.stringify({
        status,
        error,
        ready: stage === 'speech' ? !!data.record : !!data.deck,
        calls: calls.length,
      });
      if (summary !== last) {
        console.log(summary);
        last = summary;
      }
      if ((stage === 'speech' ? data.record : data.deck) || (tick > 3 && error.length)) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await Promise.all(pending);
    await writeFile(
      prefix + '-' + (stage === 'speech' ? 'speech' : stage === 'export' ? 'edited' : 'presentation') + '.json',
      JSON.stringify({ durationMs: Date.now() - started, result: data }, null, 2),
    );
    await page.screenshot({ path: prefix + '-' + stage + '.png' });
    if (stage === 'speech') assert.ok(data.record, '完整讲稿尚未保存');
    else {
      assert.ok(data.deck, '完整幻灯片尚未保存');
      if (await page.getByRole('button', { name: '4 幻灯片', exact: true }).count())
        await page.getByRole('button', { name: '4 幻灯片', exact: true }).click();
      const check = await page.evaluate(
        async (data) =>
          (await import('/src/app/presentation/checkPresentation.ts')).checkPresentation(data.deck, data.paper, true),
        data,
      );
      await writeFile(prefix + '-' + stage + '-checks.json', JSON.stringify(check, null, 2));
      assert.equal(check.errors.length, 0, JSON.stringify(check.errors));
      const download = page.waitForEvent('download', { timeout: 300000 });
      await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
      const file = await download;
      try {
        await file.saveAs(prefix + (stage === 'export' ? '-edited' : '') + '.pptx');
      } catch (error) {
        console.log(
          JSON.stringify({
            downloadFailure: await file.failure().catch(() => 'unavailable'),
            pageClosed: page.isClosed(),
            pages: browser.pages().length,
          }),
        );
        if (!page.isClosed()) await page.screenshot({ path: prefix + '-download-failure.jpg' });
        throw error;
      }
    }
    console.log('PASS: saved ' + stage + '; scientific review remains explicit');
  }
} finally {
  await browser.close();
}
