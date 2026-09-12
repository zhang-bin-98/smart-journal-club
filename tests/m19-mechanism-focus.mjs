import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const prefix = 'output/playwright/m19-mechanism-modt-cdifficile';
const prior = JSON.parse(await readFile(prefix + '-edited.json', 'utf8')).result;
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-mechanism-modt-cdifficile'), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto('http://127.0.0.1:5191/');
  const result = await page.evaluate(async (id) => {
    const { slidesService } = await import('/src/app/composition.ts');
    const state = await slidesService.open(id),
      session = slidesService.session(state);
    const changes = [],
      mutations = [];
    for (const n of [26, 29]) {
      const slide = state.current.slides[n - 1];
      const element = slide.elements.find((e) => e.type === 'figure');
      const cropOverride = { x: 335 / 1200, y: 140 / 1553, width: 800 / 1200, height: 520 / 1553 };
      mutations.push({ type: 'replace-element', slideId: slide.id, element: { ...element, cropOverride } });
      changes.push({
        slide: n,
        field: 'cropOverride',
        elementId: element.id,
        after: cropOverride,
        reason: 'Show models A–C with the complete shared scientific legend',
      });
    }
    await session.commit({ type: 'deck' }, mutations, '放大结构模型并保留完整共享图例');
    const saved = await slidesService.open(id);
    return { project: saved.project, paper: saved.paper, deck: saved.current, changes };
  }, prior.project.id);
  result.changes = [...prior.changes, ...result.changes];
  await writeFile(prefix + '-edited.json', JSON.stringify({ result }, null, 2));
  console.log('PASS: 2 model comparison pages enlarged, original sources retained');
} finally {
  await browser.close();
}
