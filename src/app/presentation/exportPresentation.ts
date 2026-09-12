import type { SlidesStore } from './slidesPorts';
import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/model';
import type { PdfAsset } from '../../modules/project/model';
import { checkPresentation } from './checkPresentation';
import { ContentError } from '../../modules/presentation/content';
import { beginActivity } from '../activity';
export type ExportPort = (input: {
  deck: Deck;
  paper: Paper;
  assets: Record<string, PdfAsset>;
  signal: AbortSignal;
  onStage?: (text: string) => void;
}) => Promise<Blob>;
/** Capture one saved deck, paper and document mapping. Cancellation is checked again before the only download. */
export async function exportPresentation(input: {
  store: Pick<SlidesStore, 'open'>;
  projectId: string;
  deck: Deck;
  signal: AbortSignal;
  export: ExportPort;
  download: (blob: Blob, name: string) => void;
  onStage?: (text: string) => void;
}) {
  const done = beginActivity();
  try {
    const state = await input.store.open(input.projectId);
    const deck = state.current;
    if (!deck || deck.id !== input.deck.id || deck.revision !== input.deck.revision)
      throw new ContentError('stale-export', '已保存稿件发生变化，请重新检查后导出。');
    const available = deck.slides
      .flatMap((s) => s.elements)
      .filter((e) => e.type === 'figure')
      .every((e) => {
        const figure = state.paper.figures.find((f) => f.id === e.figureId);
        const region = e.regionId
          ? figure?.regions.find((r) => r.id === e.regionId)
          : e.panelId
            ? figure?.regions.find((r) => r.panels.some((p) => p.id === e.panelId))
            : figure?.regions[0];
        const source = state.paper.sources.find(
          (s) => s.id === (e.panelId ? region?.panels.find((p) => p.id === e.panelId)?.sourceId : region?.sourceId),
        );
        return source && !!state.assets[source.documentId];
      });
    const check = checkPresentation(deck, state.paper, available);
    if (!deck.slides.length || check.errors.length)
      throw new ContentError('export-blocked', check.errors[0]?.message ?? '还没有幻灯片。');
    input.signal.throwIfAborted();
    const blob = await input.export({
      deck,
      paper: state.paper,
      assets: state.assets,
      signal: input.signal,
      onStage: input.onStage,
    });
    input.signal.throwIfAborted();
    input.download(blob, deck.title);
    return blob;
  } finally {
    done();
  }
}
