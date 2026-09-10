import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const env = await readFile('.env', 'utf8');
const apiKey = env
  .split(/\r?\n/)
  .find((line) => line.startsWith('DEEPSEEK_API='))
  ?.slice(13)
  .trim()
  .replace(/^['"]|['"]$/g, '');
assert.ok(apiKey);
await mkdir('output/playwright/m16-risk', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/');
  for (const name of ['omics-torc1-proteomics', 'mechanism-modt-cdifficile', 'clinical-vrc07-phase1-trial']) {
    const destination = `output/playwright/m16-risk/${name}`;
    if (
      await access(`${destination}.json`).then(
        () => true,
        () => false,
      )
    ) {
      console.log(`Reusing ${name}`);
      continue;
    }
    const pdf = (await readFile(`test-fixtures/papers/${name}.pdf`)).toString('base64');
    const prior = name.startsWith('omics')
      ? JSON.parse(await readFile('output/playwright/m15-real-analysis.json', 'utf8')).paper
      : undefined;
    console.log(`Checking ${name}`);
    const result = await page.evaluate(
      async ({ name, pdf, prior, apiKey }) => {
        const { createAnalysisResource } = await import('/src/infrastructure/pdf/analysisResource.ts');
        const { PdfResource } = await import('/src/infrastructure/pdf/pdfResource.ts');
        const { modelRequests } = await import('/src/app/composition.ts');
        const { DEFAULT_SETTINGS } = await import('/src/app/settings/modelSettings.ts');
        const { FigurePageSchema } = await import('/src/modules/paper/figureOutput.ts');
        const { LocalPanelsSchema } = await import('/src/app/paper/recognizeFigure.ts');
        const { toPageBox } = await import('/src/modules/paper/figureGeometry.ts');
        const { prompts } = await import('/src/shared/llm/prompts.ts');
        const blob = new Blob([Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0))], { type: 'application/pdf' });
        const resource = createAnalysisResource(blob);
        const pdfResource = new PdfResource(blob);
        const settings = {
          ...DEFAULT_SETTINGS,
          apiKey,
          baseUrl: 'https://api.deepseek.com',
          modelId: 'deepseek-flash',
          reasoningEffort: 'high',
        };
        const signal = AbortSignal.timeout(300000);
        async function request(input) {
          try {
            return await modelRequests.requestJson(input);
          } catch (cause) {
            if (cause?.name !== 'ModelOutputError' && !cause?.diagnostics) throw cause;
            return modelRequests.requestJson({
              ...input,
              systemPrompt: `${input.systemPrompt}\n这是唯一一次结构修复，请返回完整合法结果。`,
            });
          }
        }
        try {
          let pageNumber = 1;
          let original;
          if (prior) {
            const figure = [...prior.figures].sort(
              (a, b) => b.regions.flatMap((r) => r.panels).length - a.regions.flatMap((r) => r.panels).length,
            )[0];
            const region = figure.regions[0];
            const source = prior.sources.find((s) => s.id === region.sourceId);
            pageNumber = source.pageNumber;
            original = {
              label: figure.label,
              caption: figure.caption,
              bbox: source.bbox,
              panels: region.panels.map((p) => ({
                label: p.label,
                description: p.description,
                bbox: prior.sources.find((s) => s.id === p.sourceId).bbox,
              })),
            };
          } else {
            let score = -1;
            for (let i = 2; i <= Math.min(12, await resource.pageCount()); i++) {
              const images = await pdfResource.imageRegions(i, signal);
              if (images.length > score) {
                score = images.length;
                pageNumber = i;
              }
            }
            const image = await resource.figureInput(pageNumber, signal);
            const text = await resource.text(pageNumber, signal);
            const output = await request({
              settings,
              schema: FigurePageSchema,
              stage: 'figures',
              signal,
              image: image.image,
              systemPrompt: `${prompts.common}\n${prompts.stages.figures}`,
              data: {
                document: { fileName: `${name}.pdf` },
                pageNumber,
                pageText: text.text,
                imageRegions: image.imageRegions,
              },
            });
            original = output.figures.sort((a, b) => b.panels.length - a.panels.length)[0];
            if (!original) throw new Error(`未定位到图源，页码 ${pageNumber}`);
          }
          const local = await resource.localFigure(pageNumber, original.bbox, signal);
          try {
            const coarse = await request({
              settings,
              schema: LocalPanelsSchema,
              stage: 'figure-local',
              signal,
              image: local.image,
              systemPrompt:
                '识别当前局部高清图内真实可见的 Panel 标签、内容和矩形，bbox 使用局部图归一化坐标。保留坐标轴、图例、比例尺和科学统计标注，共享标注允许重叠。不按位置猜标签，不重绘或擦除像素。对照图注标出漏图、重复或无法完整独立裁切的疑点于 concerns；description 用中文说明可见图像内容。没有必要细分时允许空 panels。',
              data: { figureLabel: original.label, caption: original.caption, fileName: `${name}.pdf`, pageNumber },
            });
            const pixels = await local.refine(coarse.panels.map((p) => p.bbox));
            const improved = coarse.panels.map((p, index) => ({
              ...p,
              bbox: toPageBox(pixels.boxes[index], original.bbox),
              concerns: pixels.issues[index],
            }));
            const canvas = document.createElement('canvas');
            await pdfResource.render(pageNumber, canvas, 2200, signal);
            const images = [{ kind: 'page', image: canvas.toDataURL('image/png') }];
            for (const [kind, panels] of [
              ['original', original.panels],
              ['improved', improved],
            ]) {
              const grid = document.createElement('canvas');
              grid.width = 1320;
              grid.height = Math.max(380, Math.ceil(panels.length / 3) * 380);
              const ctx = grid.getContext('2d');
              ctx.fillStyle = 'white';
              ctx.fillRect(0, 0, grid.width, grid.height);
              for (const [index, panel] of panels.entries()) {
                const box = panel.bbox,
                  x = (index % 3) * 440 + 10,
                  y = Math.floor(index / 3) * 380;
                const sw = box.width * canvas.width,
                  sh = box.height * canvas.height,
                  scale = Math.min(420 / sw, 340 / sh);
                ctx.fillStyle = 'black';
                ctx.font = '18px sans-serif';
                ctx.fillText(`${kind} ${panel.label}`, x, y + 23);
                ctx.drawImage(
                  canvas,
                  box.x * canvas.width,
                  box.y * canvas.height,
                  sw,
                  sh,
                  x,
                  y + 35,
                  sw * scale,
                  sh * scale,
                );
              }
              images.push({ kind, image: grid.toDataURL('image/png') });
              grid.width = 0;
            }
            canvas.width = 0;
            return { name, pageNumber, original, coarse, improved, concerns: coarse.concerns, images };
          } finally {
            local.release();
          }
        } finally {
          await resource.dispose();
          await pdfResource.dispose();
        }
      },
      { name, pdf, prior, apiKey },
    );
    const { images, ...record } = result;
    for (const item of images)
      await writeFile(`${destination}-${item.kind}.png`, Buffer.from(item.image.split(',')[1], 'base64'));
    await writeFile(`${destination}.json`, JSON.stringify(record, null, 2));
    console.log(
      JSON.stringify({
        name,
        page: record.pageNumber,
        original: record.original.panels.length,
        improved: record.improved.length,
      }),
    );
  }
} finally {
  await browser.close();
}
