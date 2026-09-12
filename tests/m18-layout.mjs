import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const justified = require('../output/playwright/layout-reference/node_modules/justified-layout');
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const prior = JSON.parse(await readFile('output/playwright/m17-real-speech.json', 'utf8')).result;
const pdf = (await readFile('test-fixtures/papers/omics-torc1-proteomics.pdf')).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5178/');
  const groups = await page.evaluate(async (paper) => {
    const { rankGroups, groupRects, containRect } = await import('/src/modules/presentation/layout/index.ts');
    const groups = [];
    for (const label of ['Fig 3', 'Fig 5', 'Fig 6']) {
      const figure = paper.figures.find((f) => f.label === label);
      for (const count of [3, 4]) {
        const panels = figure.regions.flatMap((r) => r.panels).slice(0, count);
        const images = panels.map((p) => {
          const source = paper.sources.find((s) => s.id === p.sourceId);
          const page = paper.pages.find(
            (page) => page.documentId === source.documentId && page.pageNumber === source.pageNumber,
          );
          return {
            id: p.id,
            label: p.label,
            source,
            aspect: (page.width * source.bbox.width) / (page.height * source.bbox.height),
          };
        });
        const area = { x: 0, y: 0, width: 0.88, height: 0.57 };
        const ranked = rankGroups(images, area);
        const partitions = groupRects(ranked[0].group, area);
        const boxes = images.map((image) => {
          const box = containRect(partitions[image.id], image.aspect);
          return { left: box.x * 960, top: box.y * 540, width: box.width * 960, height: box.height * 540 };
        });
        groups.push({
          label: label + ' ' + panels.map((p) => p.label).join('/'),
          images,
          preset: ranked[0].preset,
          group: ranked[0].group,
          partition: boxes,
        });
      }
    }
    return groups;
  }, prior.paper);
  const width = 0.88 * 960,
    height = 0.57 * 540;
  for (const group of groups) {
    const result = justified(
      group.images.map((image) => image.aspect),
      { containerWidth: width, containerPadding: 0, boxSpacing: 12, targetRowHeight: height / 2, showWidows: true },
    );
    const scale = Math.min(1, height / result.containerHeight);
    group.justified = result.boxes.map((box) => ({
      left: box.left * scale,
      top: box.top * scale,
      width: box.width * scale,
      height: box.height * scale,
    }));
    group.justifiedOriginalHeight = result.containerHeight;
    group.justifiedScaled = scale < 1;
    group.minimumSide = {
      partition: Math.min(...group.partition.map((b) => Math.min(b.width, b.height))),
      justified: Math.min(...group.justified.map((b) => Math.min(b.width, b.height))),
    };
  }
  await writeFile(
    'output/playwright/m18-layout-comparison.json',
    JSON.stringify({ version: 'justified-layout 4.1.0', width, height, groups }, null, 2),
  );
  await page.evaluate(
    async ({ groups, pdf, width, height }) => {
      const { PdfResource } = await import('/src/infrastructure/pdf/pdfResource.ts');
      const resource = new PdfResource(
        new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }),
      );
      const root = document.createElement('main');
      root.style.cssText = 'padding:24px;background:white;color:#203040;font:16px Arial;';
      root.innerHTML =
        '<h1>M18 · 同一原图比例的有限分区与 Justified Layout 对照</h1><p>每行保留同一 Panel 顺序与原始像素。右侧超过固定页高时等比缩小，不隐藏图像。</p>';
      document.body.replaceChildren(root);
      const pageCache = new Map();
      for (const group of groups) {
        const title = document.createElement('h2');
        title.textContent =
          group.label + ' · 分区 ' + group.preset + ' / Justified' + (group.justifiedScaled ? '（缩放适配页高）' : '');
        root.append(title);
        const canvas = document.createElement('canvas');
        canvas.width = 1760;
        canvas.height = 385;
        canvas.style.width = '100%';
        root.append(canvas);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f2f5f7';
        ctx.fillRect(0, 0, 1760, 385);
        for (const [side, boxes] of [group.partition, group.justified].entries()) {
          const dx = side * 880 + 16,
            dy = 42;
          ctx.fillStyle = 'white';
          ctx.fillRect(dx, dy, width, height);
          ctx.fillStyle = '#203040';
          ctx.font = '18px Arial';
          ctx.fillText(side ? 'Justified Layout' : '有限分区候选', dx, 25);
          for (const [index, box] of boxes.entries()) {
            const image = group.images[index];
            let source = pageCache.get(image.source.pageNumber);
            if (!source) {
              source = document.createElement('canvas');
              await resource.render(image.source.pageNumber, source, 2600, new AbortController().signal);
              pageCache.set(image.source.pageNumber, source);
            }
            const b = image.source.bbox;
            ctx.drawImage(
              source,
              b.x * source.width,
              b.y * source.height,
              b.width * source.width,
              b.height * source.height,
              dx + box.left,
              dy + box.top,
              box.width,
              box.height,
            );
            ctx.strokeStyle = '#89a';
            ctx.strokeRect(dx + box.left, dy + box.top, box.width, box.height);
          }
        }
      }
      await resource.dispose();
    },
    { groups, pdf, width, height },
  );
  await page.screenshot({ path: 'output/playwright/m18-layout-comparison.png', fullPage: true });
  for (let index = 0; index < groups.length; index++)
    await page
      .locator('canvas')
      .nth(index)
      .screenshot({ path: 'output/playwright/m18-layout-' + index + '.jpg', type: 'jpeg', quality: 80 });
  console.log(
    JSON.stringify(
      groups.map((g) => ({ group: g.label, preset: g.preset, scaled: g.justifiedScaled, minSide: g.minimumSide })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
