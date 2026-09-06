/* biome-ignore-all lint/suspicious/noExplicitAny: mutation table intentionally edits individual contract fields */
import { describe, expect, it } from 'vitest';
import { narrativePaper, narrativePlan } from '../narrative-fixture';
import { assembleDeck } from '../../src/modules/generation/buildDeck';
import { validateBuiltDeckAgainstPlan } from '../../src/modules/generation/validateBuiltDeckAgainstPlan';
import { fixedSlides } from '../generation-contracts';

function built() {
  const plan = narrativePlan();
  const confirmed = { ...plan, status: 'confirmed' as const, confirmedAt: 1 };
  const paper = narrativePaper();
  return { plan: confirmed, deck: assembleDeck(confirmed, fixedSlides(confirmed), paper) };
}

describe('build contract', () => {
  it('合法构建通过', () => {
    const { plan, deck } = built();
    expect(validateBuiltDeckAgainstPlan(deck, plan)).toEqual([]);
  });
  it.each([
    ['paperId', (deck: any) => (deck.paperId = 'other')],
    ['title', (deck: any) => (deck.title = 'other')],
    ['language', (deck: any) => (deck.language = 'en')],
    ['section id', (deck: any) => (deck.sections[0].id = 'other')],
    ['section kind', (deck: any) => (deck.sections[0].kind = 'custom')],
    ['section purpose', (deck: any) => (deck.sections[0].purpose = 'other')],
    ['slide id', (deck: any) => (deck.slides[0].id = 'other')],
    ['slide section', (deck: any) => (deck.slides[0].sectionId = 'other')],
    ['slide kind', (deck: any) => (deck.slides[0].kind = 'custom')],
    ['slide layout', (deck: any) => (deck.slides[0].layoutId = 'text-only')],
    ['slide title', (deck: any) => (deck.slides[0].title = 'other')],
    ['slide purpose', (deck: any) => (deck.slides[0].purpose = 'other')],
    ['slide message', (deck: any) => (deck.slides[0].message = 'other')],
    ['claims', (deck: any) => (deck.slides[0].claimIds = ['other'])],
    ['sources', (deck: any) => (deck.slides[0].sourceIds = ['other'])],
    [
      'figures',
      (deck: any) =>
        (deck.slides
          .find((s: any) => s.elements.some((e: any) => e.type === 'figure'))
          .elements.find((e: any) => e.type === 'figure').figureId = 'other'),
    ],
    [
      'crop override',
      (deck: any) =>
        (deck.slides
          .find((s: any) => s.elements.some((e: any) => e.type === 'figure'))
          .elements.find((e: any) => e.type === 'figure').cropOverride = { x: 0, y: 0, width: 1, height: 1 }),
    ],
  ])('%s 失配会被拒绝', (_name, mutate) => {
    const { plan, deck } = built();
    mutate(deck);
    expect(validateBuiltDeckAgainstPlan(deck, plan).length).toBeGreaterThan(0);
  });
});
