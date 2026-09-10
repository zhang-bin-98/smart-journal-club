import type { FigureCommand } from '../../modules/paper/figureEditing';
import type { FigureSession } from './figureSession';
import type { FigureResources } from './figureResources';
import type { ModelSettings } from '../settings/modelSettings';
import type { createModelRequests } from '../llm/requests';
import { recognizeFigure } from './recognizeFigure';

/** Save the human rectangle first, then supplement only its new region; subsequent input cancels the old task. */
export async function supplementAddedRegion(input: {
  session: FigureSession;
  command: FigureCommand;
  resources: FigureResources;
  settings: ModelSettings;
  requests: ReturnType<typeof createModelRequests>;
}) {
  if (input.command.kind !== 'add-figure' || !input.settings.apiKey.trim()) return;
  const regionId = `${input.command.id}:region`;
  await input.session.enrich(async (data, signal) => {
    const figure = data.paper.figures.find((figure) => figure.regions.some((region) => region.id === regionId));
    const region = figure?.regions.find((region) => region.id === regionId);
    if (!figure || !region || region.panels.length) return undefined;
    const isolated = {
      ...data,
      paper: {
        ...data.paper,
        figures: data.paper.figures.map((item) => (item.id === figure.id ? { ...figure, regions: [region] } : item)),
      },
    };
    const result = await recognizeFigure({ ...input, data: isolated, figureId: figure.id, signal });
    if (result.kind !== 'replace-figure') return undefined;
    const regionSources = new Set([region.sourceId, ...region.panels.map((panel) => panel.sourceId)]);
    const otherIds = new Set(
      figure.regions
        .flatMap((region) => [region.sourceId, ...region.panels.map((panel) => panel.sourceId)])
        .filter((id) => !regionSources.has(id)),
    );
    return {
      ...result,
      baseline: figure.regions.length === 1,
      figure: {
        ...figure,
        regions: figure.regions.map((item) => (item.id === regionId ? result.figure.regions[0] : item)),
      },
      sources: [...data.paper.sources.filter((source) => otherIds.has(source.id)), ...result.sources],
    };
  });
}
