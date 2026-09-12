import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const paths = process.argv.slice(2);
const reports = [];
for (const path of paths) {
  const payload = JSON.parse(await readFile(path, 'utf8'));
  const { paper, deck } = payload.result || payload;
  const pages = new Set(paper.pages.map((p) => p.documentId + ':' + p.pageNumber));
  const sources = new Map(paper.sources.map((s) => [s.id, s]));
  const blocks = new Map(paper.blocks.map((b) => [b.id, b]));
  const evidence = new Map(paper.evidences.map((e) => [e.id, e]));
  const claims = new Set(paper.claims.map((c) => c.id));
  const quoteMismatches = [];
  for (const s of paper.sources) {
    assert.ok(pages.has(s.documentId + ':' + s.pageNumber), 'Invalid source page');
    if (s.textSpan) {
      const b = blocks.get(s.textSpan.blockId);
      assert.ok(b && b.documentId === s.documentId && b.pageNumber === s.pageNumber, 'Invalid text block');
      const quote = b.text.slice(s.textSpan.start, s.textSpan.end);
      assert.ok(quote.length, 'Empty exact span');
      if (s.textQuote && s.textQuote !== quote) quoteMismatches.push({ id: s.id, quote, stored: s.textQuote });
    }
  }
  for (const c of paper.claims) for (const id of c.evidenceIds) assert.ok(evidence.has(id), 'Missing evidence');
  for (const e of paper.evidences) for (const id of e.sourceIds) assert.ok(sources.has(id), 'Missing evidence source');
  const covered = new Set(deck.speech.flatMap((s) => s.claimIds));
  const omitted = new Set(deck.omissions.map((o) => o.claimId));
  const missing = [...claims].filter((id) => !covered.has(id) && !omitted.has(id));
  assert.equal(missing.length, 0, 'Uncovered findings');
  const ids = deck.slides.flatMap((s) => s.speechIds);
  assert.equal(new Set(ids).size, ids.length, 'Repeated speech assignment');
  assert.deepEqual(new Set(ids), new Set(deck.speech.map((s) => s.id)), 'Unassigned speech');
  for (const s of deck.speech) {
    for (const id of s.claimIds) assert.ok(claims.has(id), 'Foreign speech claim');
    for (const id of s.sourceIds) assert.ok(sources.has(id), 'Foreign speech source');
  }
  for (const s of deck.slides) {
    for (const id of s.sourceIds) assert.ok(sources.has(id), 'Foreign slide source');
    for (const e of s.elements.filter((e) => e.type === 'figure')) {
      const f = paper.figures.find((f) => f.id === e.figureId);
      assert.ok(f, 'Foreign figure');
      if (e.regionId)
        assert.ok(
          f.regions.some((r) => r.id === e.regionId),
          'Foreign region',
        );
      if (e.panelId)
        assert.ok(
          f.regions.some((r) => r.panels.some((p) => p.id === e.panelId)),
          'Foreign panel',
        );
    }
  }
  const track = new Map(deck.sections.map((s) => [s.id, s.track]));
  reports.push({
    path,
    pages: paper.pages.length,
    blocks: blocks.size,
    emptyPages: paper.pages
      .filter(
        (p) =>
          !paper.blocks.some((b) => b.documentId === p.documentId && b.pageNumber === p.pageNumber && b.text.trim()),
      )
      .map((p) => p.pageNumber),
    claims: claims.size,
    evidence: evidence.size,
    sources: sources.size,
    exactSpans: paper.sources.filter((s) => s.textSpan).length,
    quoteMismatches,
    figures: paper.figures.length,
    panels: paper.figures.reduce((n, f) => n + f.regions.reduce((n, r) => n + r.panels.length, 0), 0),
    speech: deck.speech.length,
    paragraphs: deck.speechParagraphs.length,
    slides: deck.slides.length,
    main: deck.slides.filter((s) => track.get(s.sectionId) === 'main').length,
    supplement: deck.slides.filter((s) => track.get(s.sectionId) === 'supplement').length,
    omissions: omitted.size,
    missing,
    images: deck.slides.reduce((n, s) => n + s.elements.filter((e) => e.type === 'figure').length, 0),
  });
}
await writeFile('output/playwright/m19-source-audit.json', JSON.stringify(reports, null, 2));
console.log(
  JSON.stringify(
    reports.map(({ quoteMismatches, ...r }) => ({ ...r, quoteMismatches: quoteMismatches.length })),
    null,
    2,
  ),
);
assert.ok(
  reports.every((r) => r.quoteMismatches.length === 0),
  'Review exact quote mismatches',
);
