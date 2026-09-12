import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'mechanism-modt-cdifficile';
const prefix = 'output/playwright/m19-' + name;
const initial = JSON.parse(await readFile(prefix + '-speech.json', 'utf8')).result;
const edits = [
  [
    '6556b9b2-e57d-4fb6-9f2d-82bd707b3237',
    'On the gel, the two species resolve as bands above the 242-nt marker.',
    'The body reports approximately 260 nt for ModT(L), while Fig 1 labels 258 nt; ModT(S) is 215 nt. Thus the two isoforms lie on opposite sides of the 242-nt marker.',
  ],
  [
    'fb382f24-3e00-4cdd-9a65-4c52a1fda4a0',
    "Extending this, they propose that ModT's regulatory function has a direct impact on stationary-phase pathways such as sporulation and toxin production, via changes in cellular c-di-GMP levels.",
    'The double-knockout experiments support the c-di-GMP route for sporulation; toxin production is only partially restored, indicating additional c-di-GMP-independent regulation.',
  ],
  [
    '530bbafc-0516-45d2-92b8-823920ca820c',
    'the short isoform is sufficient for ModT function.',
    'the short isoform is sufficient to rescue the growth phenotype; sporulation later shows an isoform-specific difference.',
  ],
  [
    'cce7bcb9-5dd5-4e40-afda-76a267c198a0',
    'sporulation is not just delayed in ΔmodT but permanently repressed.',
    'sporulation remains suppressed throughout the five-day observation window, rather than merely showing a short delay; this does not establish indefinite repression.',
  ],
  [
    '9500a296-a0c5-402e-85b9-d946633138d2',
    '(Fig 1C).',
    '(the body cites Fig 1C, but expression across carbon sources is shown in Fig 1B; Fig 1C ranks transcript abundance).',
  ],
  [
    '48ef6570-82f7-4b66-9f70-65f64ebc7868',
    'using the same RNA as in Fig 1C.',
    'using the same RNA as the expression experiment (the S1 caption cites Fig 1C, whereas the expression panel is Fig 1B).',
  ],
  [
    'cf04318b-842d-470f-8d1e-6bcdb8d4197d',
    'the raw data used for the c-di-GMP quantification in Fig 4A',
    'the raw data for c-di-GMP quantification (the S5 caption cites Fig 4A, whereas the main c-di-GMP reporter results appear in Fig 5B)',
  ],
  [
    '94f61496-b689-40fa-a891-994fadaf0905',
    'For data availability, the relevant data can be obtained under 1073/pnas.2103579118 and the accession number GSE155167.',
    'The S1A caption identifies the reused transcript-mapping data from the earlier study, DOI 10.1073/pnas.2103579118 and GEO GSE155167. These are not the accession numbers for the present study’s new RNA-seq or DMS-MaP data.',
  ],
  [
    'cfc12550-dd03-4bb9-bdda-b502887a19cb',
    'across the grid, the mutant columns show refractile structures consistent with spores at the later time points.',
    'the images must be interpreted by strain: ΔmodT has reduced sporulation, the long-isoform complement restores it, and the short-isoform complement shows hyper-sporulation.',
  ],
];
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const result = await page.evaluate(
    async ({ id, edits }) => {
      const app = await import('/src/app/composition.ts');
      const session = app.createSpeechSession(id, true);
      await session.load();
      const content = session.snapshot().data.target.content;
      const changes = [],
        paragraphs = new Map();
      for (const [sid, from, to] of edits) {
        const segment = content.speech.find((s) => s.id === sid);
        if (!segment?.text.includes(from)) throw Error('Reviewed text changed: ' + sid);
        const text =
          paragraphs.get(segment.paragraphId) ??
          content.speech
            .filter((s) => s.paragraphId === segment.paragraphId)
            .map((s) => s.text)
            .join('');
        paragraphs.set(segment.paragraphId, text.replace(from, to));
        changes.push({ segmentId: sid, from, to });
      }
      await session.commit(
        [...paragraphs].map(([paragraphId, text]) => ({ type: 'update-paragraph', paragraphId, text })),
      );
      const state = await app.slidesStore.open(id);
      session.close();
      return {
        changes,
        result: { project: state.project, paper: state.workingPaper, record: state.record, deck: state.current },
      };
    },
    { id: initial.project.id, edits },
  );
  await writeFile(prefix + '-speech-edited.json', JSON.stringify(result, null, 2));
  console.log('PASS: 9 scientific speech corrections');
} finally {
  await browser.close();
}
