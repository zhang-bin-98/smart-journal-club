import { associateFigureCaptions } from './figureCaptions';
import { containsBBox, type BBox } from '../../shared/schema';
import { getUnitInputKey, unitComplete } from './analysisUnits';
import { type FigureRef, type Paper, PaperError, validatePaper } from './model';

export type FigureDestination = { kind: 'existing'; figureId: string } | { kind: 'new'; label?: string };
export type FigureContent = Pick<
  Paper,
  'figures' | 'sources' | 'evidences' | 'claims' | 'story' | 'studyProfile' | 'pendingEvidenceFigureIds'
>;
export type FigureCommand =
  | { kind: 'box'; regionId: string; panelId?: string; bbox: BBox }
  | { kind: 'add-panel'; regionId: string; bbox: BBox; label?: string; id: string }
  | { kind: 'delete-panel'; regionId: string; panelId: string }
  | { kind: 'label'; regionId: string; panelId: string; label: string }
  | { kind: 'associate'; regionId: string; panelId: string; links: { sourceId: string; role: 'panel' | 'shared' }[] }
  | {
      kind: 'add-figure';
      documentId: string;
      pageNumber: number;
      bbox: BBox;
      destination: FigureDestination;
      id: string;
    }
  | { kind: 'move-region'; regionId: string; destination: FigureDestination; id: string; confirmed?: boolean }
  | { kind: 'replace-figure'; figureId: string; figure: FigureRef; sources: Paper['sources']; baseline?: boolean }
  | { kind: 'restore'; content: FigureContent }
  | { kind: 'refresh-associations' }
  | { kind: 'confirm'; at: number };

export function figureContent(paper: Paper): FigureContent {
  return structuredClone({
    figures: paper.figures,
    sources: paper.sources,
    evidences: paper.evidences,
    claims: paper.claims,
    story: paper.story,
    studyProfile: paper.studyProfile,
    pendingEvidenceFigureIds: paper.pendingEvidenceFigureIds,
  });
}

export function regionIn(paper: Pick<Paper, 'figures' | 'sources'>, regionId: string) {
  const figure = paper.figures.find((item) => item.regions.some((region) => region.id === regionId));
  const region = figure?.regions.find((item) => item.id === regionId);
  const source = paper.sources.find((item) => item.id === region?.sourceId);
  if (!figure || !region || !source?.bbox) throw new PaperError('missing-region', '该图块已变化，请重新选择。');
  return { figure, region, source };
}

/** Figure labels are display text; ambiguous labels never select an identity implicitly. */
export function resolveFigureDestination(
  paper: Pick<Paper, 'figures'>,
  label: string,
  selectedId?: string,
): FigureDestination {
  if (selectedId) {
    if (!paper.figures.some((figure) => figure.id === selectedId))
      throw new PaperError('missing-figure', '目标图已不存在。');
    return { kind: 'existing', figureId: selectedId };
  }
  const matches = label.trim() ? paper.figures.filter((figure) => figure.label?.trim() === label.trim()) : [];
  if (matches.length > 1) throw new PaperError('ambiguous-label', '有多个同名图，请从列表明确选择来源。');
  return matches.length
    ? { kind: 'existing', figureId: matches[0].id }
    : { kind: 'new', label: label.trim() || undefined };
}

function pruneReferences(next: Paper, removed: Set<string>) {
  next.evidences = next.evidences.map((evidence) => ({
    ...evidence,
    sourceIds: evidence.sourceIds.filter((id) => !removed.has(id)),
  }));
  if (next.story)
    for (const points of Object.values(next.story))
      for (const point of points) point.sourceIds = point.sourceIds.filter((id) => !removed.has(id));
  if (next.studyProfile) {
    next.studyProfile.sourceIds = next.studyProfile.sourceIds.filter((id) => !removed.has(id));
  }
}

/** Preserve completed text/evidence units when only source editing changed their dependency representation.
 * Semantic gaps remain explicit in pendingEvidenceFigureIds until the local association workflow completes. */
function rebaseCompletedUnits(previous: Paper, next: Paper) {
  next.analysisUnits = next.analysisUnits
    .filter(
      (unit) =>
        unit.target.kind !== 'region' ||
        next.figures.some(
          (figure) =>
            unit.target.kind === 'region' &&
            figure.id === unit.target.figureId &&
            figure.regions.some((region) => unit.target.kind === 'region' && region.id === unit.target.regionId),
        ),
    )
    .map((unit) =>
      unitComplete(previous, unit.stage, unit.target)
        ? { ...unit, inputKey: getUnitInputKey(next, unit.stage, unit.target) }
        : unit,
    );
}

/** The only graph edit entry. Validate the whole transaction before exposing any result. */
export function applyFigureCommand(paper: Paper, command: FigureCommand): Paper {
  const next = structuredClone(paper);
  let geometry = command.kind !== 'associate' && command.kind !== 'confirm' && command.kind !== 'refresh-associations';
  const affected = new Set<string>();
  const removed = new Set<string>();
  if (command.kind === 'refresh-associations') {
    for (const figure of next.figures) affected.add(figure.id);
  } else if (command.kind === 'confirm') {
    next.figureReview.confirmedRevision = next.figureReview.revision;
    next.figureReview.confirmedAt = command.at;
  } else if (command.kind === 'restore') {
    Object.assign(next, structuredClone(command.content));
  } else if (command.kind === 'add-figure') {
    if (!next.pages.some((page) => page.documentId === command.documentId && page.pageNumber === command.pageNumber))
      throw new PaperError('missing-page', '请选择已上传文件中的原页。');
    const sourceId = `${command.id}:source`;
    const region = { id: `${command.id}:region`, sourceId, panels: [] };
    next.sources.push({
      id: sourceId,
      kind: 'figure',
      documentId: command.documentId,
      pageNumber: command.pageNumber,
      bbox: command.bbox,
      geometryOrigin: 'manual',
    });
    if (command.destination.kind === 'new') {
      next.figures.push({ id: command.id, label: command.destination.label, regions: [region] });
      affected.add(command.id);
    } else {
      const destination = command.destination;
      const figure = next.figures.find((item) => item.id === destination.figureId);
      if (!figure) throw new PaperError('missing-figure', '目标图已不存在。');
      figure.regions.push(region);
      affected.add(figure.id);
    }
  } else if (command.kind === 'replace-figure') {
    const index = next.figures.findIndex((figure) => figure.id === command.figureId);
    if (index < 0 || command.figure.id !== command.figureId) throw new PaperError('missing-figure', '候选目标不匹配。');
    const original = next.figures[index];
    const ids = new Set(
      original.regions.flatMap((region) => [region.sourceId, ...region.panels.map((panel) => panel.sourceId)]),
    );
    for (const id of ids) if (!command.sources.some((source) => source.id === id)) removed.add(id);
    next.sources = [...next.sources.filter((source) => !ids.has(source.id)), ...structuredClone(command.sources)];
    next.figures[index] = structuredClone(command.figure);
    affected.add(command.figureId);
    if (command.baseline) {
      const baseline = next.figureReview.automaticBaseline ?? { figures: [], sources: [] };
      const old = baseline.figures.find((figure) => figure.id === command.figureId);
      const oldIds = new Set(
        old?.regions.flatMap((region) => [region.sourceId, ...region.panels.map((panel) => panel.sourceId)]) ?? [],
      );
      next.figureReview.automaticBaseline = {
        figures: [
          ...baseline.figures.filter((figure) => figure.id !== command.figureId),
          structuredClone(command.figure),
        ],
        sources: [...baseline.sources.filter((source) => !oldIds.has(source.id)), ...structuredClone(command.sources)],
      };
    }
  } else {
    const { figure, region, source } = regionIn(next, command.regionId);
    if (command.kind === 'move-region') {
      if (command.destination.kind === 'existing' && command.destination.figureId === figure.id) return paper;
      if (command.destination.kind === 'existing' && !command.confirmed)
        throw new PaperError('move-confirmation', '请确认当前图块的原归属、来源页和目标图。');
      let target: FigureRef;
      if (command.destination.kind === 'new') {
        target = {
          id: command.id,
          label: command.destination.label,
          captionSourceIds: [...(figure.captionSourceIds ?? [])],
          regions: [],
        };
        next.figures.push(target);
      } else {
        const destination = command.destination;
        target = next.figures.find((item) => item.id === destination.figureId)!;
        if (!target) throw new PaperError('missing-figure', '目标图已不存在。');
        // Retain the moved panels' original caption sources without transferring scientific conclusions.
        target.captionSourceIds = [
          ...new Set([
            ...(target.captionSourceIds ?? []),
            ...region.panels.flatMap((panel) => panel.captionAssociation?.links.map((link) => link.sourceId) ?? []),
          ]),
        ];
      }
      figure.regions = figure.regions.filter((item) => item.id !== region.id);
      target.regions.push(region);
      next.figures = next.figures.filter((item) => item.regions.length);
      affected.add(figure.id);
      affected.add(target.id);
    } else if (command.kind === 'add-panel') {
      if (!containsBBox(source.bbox!, command.bbox))
        throw new PaperError('outside-figure', '子图超出整图，请先扩大整图边界。');
      const sourceId = `${command.id}:source`;
      next.sources.push({ ...source, id: sourceId, kind: 'panel', bbox: command.bbox, geometryOrigin: 'manual' });
      region.panels.push({
        id: command.id,
        sourceId,
        label: command.label || undefined,
        labelOrigin: 'manual',
        captionAssociation: { links: [], origin: 'automatic', status: 'needs-review' },
      });
      affected.add(figure.id);
    } else {
      const panel =
        'panelId' in command && command.panelId ? region.panels.find((item) => item.id === command.panelId) : undefined;
      if ('panelId' in command && command.panelId && !panel)
        throw new PaperError('missing-panel', '选中的子图已不存在。');
      if (command.kind === 'box') {
        let target = panel ? next.sources.find((item) => item.id === panel.sourceId)! : source;
        if (JSON.stringify(target.bbox) === JSON.stringify(command.bbox)) return paper;
        if (panel && !containsBBox(source.bbox!, command.bbox))
          throw new PaperError('outside-figure', '子图超出整图，请先扩大整图边界。');
        if (
          !panel &&
          region.panels.some(
            (item) => !containsBBox(command.bbox, next.sources.find((source) => source.id === item.sourceId)!.bbox!),
          )
        )
          throw new PaperError('panels-outside', '新整图边界会切掉已有 Panel，请扩大整图边界；其他框尚未移动。');
        if (panel && target.id === source.id) {
          target = { ...target, id: `${panel.id}:independent-source`, kind: 'panel' };
          panel.sourceId = target.id;
          next.sources.push(target);
        }
        target.bbox = command.bbox;
        target.geometryOrigin = 'manual';
      } else if (command.kind === 'delete-panel') {
        if (
          !next.figures.some((item) =>
            item.regions.some(
              (other) =>
                other.sourceId === panel!.sourceId ||
                other.panels.some((candidate) => candidate.id !== panel!.id && candidate.sourceId === panel!.sourceId),
            ),
          )
        ) {
          removed.add(panel!.sourceId);
          next.sources = next.sources.filter((item) => item.id !== panel!.sourceId);
        }
        region.panels = region.panels.filter((item) => item.id !== panel!.id);
        affected.add(figure.id);
      } else if (command.kind === 'label') {
        if ((panel!.label ?? '') === command.label.trim()) return paper;
        panel!.label = command.label.trim() || undefined;
        panel!.labelOrigin = 'manual';
        if (panel!.captionAssociation) panel!.captionAssociation.status = 'needs-review';
        affected.add(figure.id);
      } else if (command.kind === 'associate') {
        if (
          new Set(command.links.map((link) => link.sourceId)).size !== command.links.length ||
          command.links.some((link) => !(figure.captionSourceIds ?? []).includes(link.sourceId))
        )
          throw new PaperError('invalid-caption', '请选择当前图注中的有效片段，每段只关联一次。');
        panel!.captionAssociation = {
          links: command.links,
          origin: 'manual',
          status: command.links.length ? 'linked' : 'needs-review',
        };
        geometry = false;
      }
    }
  }
  pruneReferences(next, removed);
  if (geometry)
    next.figureReview = {
      ...next.figureReview,
      revision: next.figureReview.revision + 1,
      confirmedRevision: undefined,
      confirmedAt: undefined,
    };
  next.pendingEvidenceFigureIds = [...new Set([...next.pendingEvidenceFigureIds, ...affected])].filter((id) =>
    next.figures.some((figure) => figure.id === id),
  );
  associateFigureCaptions(next, [...affected]);
  const validated = validatePaper(next);
  rebaseCompletedUnits(paper, validated);
  return validated;
}

/** Restore one automatic Figure into a reviewable candidate, never directly into storage. */
export function baselineCommand(paper: Paper, figureId: string): FigureCommand {
  const baseline = paper.figureReview.automaticBaseline;
  const figure = baseline?.figures.find((item) => item.id === figureId);
  if (!figure || !baseline) throw new PaperError('missing-baseline', '此图没有自动基线，可使用重新识别。');
  const ids = new Set(
    figure.regions.flatMap((region) => [region.sourceId, ...region.panels.map((panel) => panel.sourceId)]),
  );
  return { kind: 'replace-figure', figureId, figure, sources: baseline.sources.filter((source) => ids.has(source.id)) };
}
