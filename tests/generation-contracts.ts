// Historical plan/deck pure fixtures; no workflow or storage is executed here.
import { fixtureDeck } from './fixtures';
import { narrativePlan } from './narrative-fixture';
import type { DeckPlan } from '../src/modules/presentation/legacy/outline.schema';
import type { Paper } from '../src/modules/paper/paper.schema';

export function fixedOutline(paper: Paper): DeckPlan {
  const plan = narrativePlan();
  plan.paperId = paper.id;
  plan.title = paper.metadata.title ?? plan.title;
  plan.slides = plan.slides.map((slide) => ({
    ...slide,
    claimIds: slide.kind === 'result' ? [paper.claims[0].id] : [],
    sourceIds: slide.kind === 'result' ? paper.sources.map((source) => source.id) : [],
    figures: slide.figures.map(() => ({ figureId: paper.figures[0].id })),
  }));
  const secondResult = plan.slides.filter((slide) => slide.kind === 'result')[1];
  secondResult.layoutId = 'figure-full';
  secondResult.figures = [{ figureId: paper.figures[0].id }];
  return plan;
}

export function fixedPlanningContent(paper: Paper) {
  const { title, language, sections, slides, claimEmphasis } = fixedOutline(paper);
  return { title, language, sections, slides, claimEmphasis };
}

export function fixedPlan(paper: Paper): DeckPlan {
  const figure = paper.figures[0];
  return {
    schemaVersion: 2,
    id: 'fixture-plan',
    paperId: paper.id,
    title: fixtureDeck.title,
    language: fixtureDeck.language,
    status: 'draft',
    revision: 0,
    sections: fixtureDeck.sections.map((section) => ({ ...section, slideBudget: 1 })),
    slides: fixtureDeck.slides.map(({ elements, purpose, message, ...slide }) => ({
      ...slide,
      purpose: purpose ?? '',
      message: message ?? '',
      sourceIds: [figure.sourceId],
      claimIds: [],
      figures: elements.filter((element) => element.type === 'figure').map(() => ({ figureId: figure.id })),
    })),
    claimEmphasis: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
export function fixedSlides(plan: DeckPlan) {
  if (plan.slides.length !== fixtureDeck.slides.length)
    return {
      slides: plan.slides.map((slide) => ({
        id: slide.id,
        elements: slide.figures.length
          ? slide.figures.map((figure, index) => ({ id: `${slide.id}-figure-${index}`, type: 'figure', ...figure }))
          : [{ id: `${slide.id}-text`, type: 'text', text: slide.message || slide.title }],
      })),
    };
  return {
    slides: plan.slides.map((slide, index) => {
      let figureIndex = 0;
      return {
        id: slide.id,
        elements: fixtureDeck.slides[index].elements.map((element) =>
          element.type === 'figure'
            ? { ...element, ...slide.figures[figureIndex++] }
            : element.type === 'citation'
              ? { ...element, sourceIds: slide.sourceIds }
              : element,
        ),
      };
    }),
  };
}
