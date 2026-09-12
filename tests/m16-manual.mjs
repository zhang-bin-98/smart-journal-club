import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:5176/');
  for (const name of ['omics-torc1-proteomics', 'mechanism-modt-cdifficile', 'clinical-vrc07-phase1-trial']) {
    const record = JSON.parse(await readFile(`output/playwright/m16-risk/${name}.json`, 'utf8'));
    const pdf = (await readFile(`test-fixtures/papers/${name}.pdf`)).toString('base64');
    const id = await page.evaluate(
      async ({ record, pdf, name }) => {
        const { createProject } = await import('/src/infrastructure/persistence/projectStore.ts');
        const { transaction } = await import('/src/infrastructure/persistence/indexedDb.ts');
        const blob = new Blob([Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0))], { type: 'application/pdf' });
        const data = await createProject({ primary: new File([blob], `${name}.pdf`, { type: 'application/pdf' }) });
        const paper = data.paper;
        const documentId = paper.documents[0].id;
        paper.documents[0].pageCount = record.pageNumber;
        paper.pages = [{ documentId, pageNumber: record.pageNumber, width: 1700, height: 2200, blockIds: [] }];
        paper.sources = [
          {
            id: 'region-source',
            kind: 'figure',
            documentId,
            pageNumber: record.pageNumber,
            bbox: record.original.bbox,
            geometryOrigin: 'automatic',
          },
          ...record.improved.map((panel) => ({
            id: `${panel.label}-source`,
            kind: 'panel',
            documentId,
            pageNumber: record.pageNumber,
            bbox: panel.bbox,
            geometryOrigin: 'automatic',
          })),
        ];
        paper.figures = [
          {
            id: 'risk',
            label: record.original.label,
            caption: record.original.caption,
            captionSourceIds: [],
            regions: [
              {
                id: 'risk-region',
                sourceId: 'region-source',
                panels: record.improved.map((panel) => ({
                  id: panel.label,
                  label: panel.label,
                  sourceId: `${panel.label}-source`,
                })),
              },
            ],
          },
        ];
        paper.figureReview.automaticBaseline = {
          figures: structuredClone(paper.figures),
          sources: structuredClone(paper.sources),
        };
        const project = { ...data.project, name, lastOpenedStep: 'figure-review', checkpoint: 'paper-ready' };
        await transaction(['papers', 'projects'], 'readwrite', async (tx) => {
          tx.objectStore('papers').put(paper, paper.id);
          tx.objectStore('projects').put(project, project.id);
        });
        return project.id;
      },
      { record, pdf, name },
    );
    await page.goto(`http://127.0.0.1:5176/#/project/${id}`);
    await page.getByRole('button', { name: '确认切分', exact: true }).waitFor();
    const card = page.locator('article[data-region]');
    const svg = card.getByRole('application');
    const savedPaper = () =>
      page.evaluate(
        async (id) => (await (await import('/src/infrastructure/persistence/projectStore.ts')).openProject(id)).paper,
        id,
      );
    async function edge(handle, target, frame) {
      await page.waitForFunction(
        () => document.querySelector('svg[role="application"]')?.getAttribute('aria-busy') === 'false',
      );
      await page.getByText('已保存', { exact: true }).first().waitFor();
      const control = svg.getByRole('button', { name: `调整${handle}边界`, exact: true });
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      const view = await svg.boundingBox();
      assert.ok(rect && view);
      const beforePaper = await savedPaper();
      const before = beforePaper.revision;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const toX = handle === 'e' || handle === 'w' ? view.x + ((target - frame.x) / frame.width) * view.width : x;
      const toY = handle === 's' || handle === 'n' ? view.y + ((target - frame.y) / frame.height) * view.height : y;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(
        async ({ id, before }) =>
          (await (await import('/src/infrastructure/persistence/projectStore.ts')).openProject(id)).paper.revision >
          before,
        { id, before },
      );
      const afterPaper = await savedPaper();
      assert.equal(
        afterPaper.sources.filter(
          (source) =>
            JSON.stringify(source.bbox) !==
            JSON.stringify(beforePaper.sources.find((old) => old.id === source.id)?.bbox),
        ).length,
        1,
        '一次手柄操作应只修改一个源框',
      );
    }
    if (name.startsWith('omics')) {
      await page.getByRole('button', { name: '整图边界', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('svg[role="application"]')?.getAttribute('aria-busy') === 'false',
      );
      await edge('s', 0.643, { x: 0, y: 0, width: 1, height: 1 });
      await page.getByRole('button', { name: '选取', exact: true }).click();
      const frame = { ...record.original.bbox, height: 0.643 - record.original.bbox.y };
      for (const [label, left, right] of [
        ['F', 0.526, 0.638],
        ['G', 0.621, 0.734],
        ['H', 0.714, 0.827],
        ['I', 0.808, 0.918],
      ]) {
        await card.getByRole('button', { name: label, exact: true }).click();
        await edge('n', 0.465, frame);
        await edge('s', 0.638, frame);
        await edge('w', left, frame);
        await edge('e', right, frame);
      }
      await card.getByRole('button', { name: 'E', exact: true }).click();
      await edge('s', 0.638, frame);
    } else if (name.startsWith('mechanism')) {
      for (const label of ['B', 'D']) {
        await card.getByRole('button', { name: label, exact: true }).click();
        await edge('s', 0.66, record.original.bbox);
      }
    } else {
      await card.getByRole('button', { name: 'B', exact: true }).click();
    }
    await page.getByRole('button', { name: '确认切分', exact: true }).click();
    await page.getByRole('button', { name: '切分已确认', exact: true }).waitFor();
    const saved = await savedPaper();
    await page.waitForFunction(
      () =>
        document.querySelector('svg[role="application"]')?.getAttribute('aria-busy') === 'false' &&
        [...document.querySelectorAll('canvas[aria-label="当前选区严格裁切预览"]')].some(
          (canvas) => !canvas.classList.contains('hidden') && canvas.width > 1,
        ),
    );
    await page.screenshot({ path: `output/playwright/m16-risk/${name}-manual-ui.png` });
    const image = await page.evaluate(
      async ({ saved, pdf }) => {
        const { PdfResource } = await import('/src/infrastructure/pdf/pdfResource.ts');
        const resource = new PdfResource(new Blob([Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0))]));
        const canvas = document.createElement('canvas');
        await resource.render(saved.pages[0].pageNumber, canvas, 2200, new AbortController().signal);
        const panels = saved.figures[0].regions[0].panels;
        const grid = document.createElement('canvas');
        grid.width = 1320;
        grid.height = Math.ceil(panels.length / 3) * 380;
        const ctx = grid.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, grid.width, grid.height);
        panels.forEach((panel, index) => {
          const box = saved.sources.find((source) => source.id === panel.sourceId).bbox;
          const x = (index % 3) * 440 + 10;
          const y = Math.floor(index / 3) * 380;
          const sw = box.width * canvas.width;
          const sh = box.height * canvas.height;
          const scale = Math.min(420 / sw, 340 / sh);
          ctx.fillStyle = 'black';
          ctx.font = '18px sans-serif';
          ctx.fillText(`manual ${panel.label}`, x, y + 23);
          ctx.drawImage(canvas, box.x * canvas.width, box.y * canvas.height, sw, sh, x, y + 35, sw * scale, sh * scale);
        });
        const image = grid.toDataURL('image/jpeg', 0.85);
        await resource.dispose();
        return image;
      },
      { saved, pdf },
    );
    await writeFile(`output/playwright/m16-risk/${name}-manual.jpg`, Buffer.from(image.split(',')[1], 'base64'));
    await writeFile(
      `output/playwright/m16-risk/${name}-manual.json`,
      JSON.stringify({ name, sources: saved.sources, figureReview: saved.figureReview }, null, 2),
    );
    console.log(`${name} manual comparison saved`);
  }
} finally {
  await browser.close();
}
