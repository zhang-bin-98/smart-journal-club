import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'clinical-vrc07-phase1-trial';
const prefix = 'output/playwright/m19-' + name;
const initial = JSON.parse(await readFile(prefix + '-presentation.json', 'utf8')).result;
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const changes = await page.evaluate(async (id) => {
    const { slidesService } = await import('/src/app/composition.ts');
    const state = await slidesService.open(id),
      session = slidesService.session(state);
    const titles = {
      11: '仅 IM 组设盲；第 64 周完成 5 剂，随访至第 112 周',
      38: '实测与 2 房室模型预测的血清浓度高度相关（ρ = 0.99）',
      52: '模型假设阈值 200：首剂后 8 周最高剂量组仅 3/7 病毒株达标',
      94: '作者倾向 IV；改良 SC 方案的可接受性与成本仍需权衡',
    };
    const mutations = [],
      changes = [];
    for (const [number, title] of Object.entries(titles)) {
      const slide = state.current.slides[Number(number) - 1];
      mutations.push({ type: 'update-slide', slideId: slide.id, changes: { title } });
      changes.push({ slide: Number(number), before: slide.title, after: title });
    }
    for (const number of [29, 30]) {
      const slide = state.current.slides[number - 1],
        element = slide.elements.find((e) => e.type === 'text');
      const text =
        number === 29
          ? element.text + ' 本研究未验证 HIV-1 预防效力。'
          : '多数参与者认为给药相关不适、疼痛与焦虑可接受；认为时间投入可接受的比例在各访视与组别均 >87%。两 SC 组对不适等的接受度较低；多数愿意（>77% 非常、>4% 有些）使用相同方法，末次 SPA 中 SC 组推荐比例最低（77.4%）。';
      mutations.push({ type: 'replace-element', slideId: slide.id, element: { ...element, text } });
      changes.push({ slide: number, before: element.text, after: text });
    }
    await session.commit({ type: 'deck' }, mutations, '核对给药时点、接受度统计范围和模型推论边界');
    return changes;
  }, initial.project.id);
  await writeFile(prefix + '-page-manual.json', JSON.stringify(changes, null, 2));
  console.log('PASS: 6 slides manually corrected');
} finally {
  await browser.close();
}
