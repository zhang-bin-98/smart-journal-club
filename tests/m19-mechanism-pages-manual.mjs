import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'mechanism-modt-cdifficile',
  prefix = 'output/playwright/m19-' + name;
const prior = JSON.parse(await readFile(prefix + '-language.json', 'utf8')).result;
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const result = await page.evaluate(async (id) => {
    const { slidesService } = await import('/src/app/composition.ts');
    const state = await slidesService.open(id),
      session = slidesService.session(state);
    const changes = [],
      mutations = [];
    const titles = {
      6: 'Hypothesis: ModT regulates a fundamental process beyond sporulation',
      102: 'Short-isoform hyper-sporulation suggests additional c-di-GMP-independent roles',
      109: 'ModT declines in stationary phase; glucose can prolong expression',
    };
    for (const [n, title] of Object.entries(titles)) {
      const slide = state.current.slides[Number(n) - 1];
      mutations.push({ type: 'update-slide', slideId: slide.id, changes: { title } });
      changes.push({ slide: Number(n), field: 'title', before: slide.title, after: title });
    }
    const texts = {
      12: 'ModT(L) is highly stable (>180 min), unlike ModT(S) (45.94 min) and nc008 (22.95 min).',
      82: 'The first 215 nt were replaced by ortholog motifs from C. perfringens, CAG:138, P. sordellii and A. arabaticum. A taxonomy discrepancy in the paper is noted in the speaker notes.',
      109: 'Expression decreases in stationary phase; glucose supplementation extends ModT expression. Fig 6D includes medium-dependent differences.',
    };
    for (const [n, text] of Object.entries(texts)) {
      const slide = state.current.slides[Number(n) - 1],
        element = slide.elements.find((e) => e.type === 'text');
      if (element) mutations.push({ type: 'replace-element', slideId: slide.id, element: { ...element, text } });
      else mutations.push({ type: 'update-slide', slideId: slide.id, changes: { message: text } });
      changes.push({
        slide: Number(n),
        field: element ? 'text' : 'message',
        before: element?.text ?? slide.message,
        after: text,
      });
    }
    const notes = [
      [
        12,
        'd094647b-df50-41d5-b724-747356c3a190',
        'Stability was measured directly with rifampicin run-off assays in mid-exponential cultures. The long isoform ModT(L) was highly stable, with a half-life exceeding 180 min, like 5S rRNA; ModT(S) and nc008 decayed faster, with half-lives of 45.94 and 22.95 min respectively.',
      ],
      [
        21,
        '7027d42b-d142-4353-9760-0cdbc1dfc49d-pagepart-4',
        ' Across the time course, the long isoform ModT(L) is substantially more stable than ModT(S); their reported half-lives are >180 min and 45.94 min, respectively.',
      ],
      [
        82,
        'cd26543d-fbc8-4726-86c3-56f9df19727e-pagepart-4',
        ' In addition, they chose Acetohalobium arabaticum, genus Acetohalobium, family Halobacteroidaceae. The paper assigns it to Actinomycetota. Manual review notes that NCBI Taxonomy currently places this species in Bacillota (TaxID 28187; checked 2026-09-12: https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=28187&mode=Info). This external taxonomy check does not change which ortholog was tested.',
      ],
      [
        109,
        '36d6a96b-2341-4865-8ba4-74312b8add9a-pagepart-2',
        ' sordellii; Fig 6D shows medium-dependent expression, with glucose extending the signal into stationary phase. Thus the general decline should not be read as complete depletion in every medium. The 5S rRNA signal serves as loading control.',
      ],
    ];
    for (const [n, segmentId, text] of notes) {
      const segment = state.current.speech.find((s) => s.id === segmentId);
      if (!segment) throw Error('Missing reviewed segment');
      mutations.push({ type: 'edit-speech', segmentId, text });
      changes.push({ slide: n, field: 'speech', segmentId, before: segment.text, after: text });
    }
    await session.commit({ type: 'deck' }, mutations, '核对异构体稳定性、原文分类疑点、碳源条件及推论边界');
    const saved = await slidesService.open(id);
    return { project: saved.project, paper: saved.paper, deck: saved.current, changes };
  }, prior.project.id);
  await writeFile(prefix + '-edited.json', JSON.stringify({ result }, null, 2));
  console.log('PASS: reviewed changes on 6 slides and 4 speech segments');
} finally {
  await browser.close();
}
