import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/model';

export type FigureConsumer = { label: string; deck: Deck; paper: Paper };

/** Read-only impact follows each saved manuscript's own Paper, including old Figure identities. */
export function figureConsumers(consumers: FigureConsumer[], sourceIds: string[]) {
  return consumers.flatMap(({ label, deck, paper }) => {
    const figures = paper.figures.filter((figure) =>
      figure.regions.some(
        (region) =>
          sourceIds.includes(region.sourceId) || region.panels.some((panel) => sourceIds.includes(panel.sourceId)),
      ),
    );
    return deck.slides.flatMap((slide, index) => {
      const uses =
        slide.sourceIds.some((id) => sourceIds.includes(id)) ||
        slide.elements.some(
          (element) => element.type === 'figure' && figures.some((figure) => figure.id === element.figureId),
        );
      return uses ? [{ id: `${deck.id}:${slide.id}`, label, page: index + 1, title: slide.title }] : [];
    });
  });
}
