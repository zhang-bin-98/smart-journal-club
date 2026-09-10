import { figureConsumers } from '../../app/paper/figureImpact';
import { captionLabels } from '../../modules/paper/figureCaptions';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createReviewSession, createReviewResources, supplementReviewRegion } from '../../app/composition';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { FigureResources } from '../../app/paper/figureResources';
import { regionIn, resolveFigureDestination, type FigureCommand } from '../../modules/paper/figureEditing';
import type { BBox } from '../../shared/schema';
import { errorMessage } from '../controls';

type Draft = { regionId: string; panelId?: string; bbox: BBox };
type TitleDraft = {
  regionId?: string;
  value: string;
  selectedId?: string;
  documentId: string;
  pageNumber: number;
  bbox?: BBox;
};
export function useFigureReview({
  id,
  settings,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const session = useMemo(() => createReviewSession(id), [id]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [resources, setResources] = useState<FigureResources>();
  const [regionId, setRegionId] = useState<string>();
  const [panelId, setPanelId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [mode, setMode] = useState<'select' | 'panel' | 'region'>('select');
  const [label, setLabel] = useState<string>();
  const [title, setTitle] = useState<TitleDraft>();
  const [moveConfirm, setMoveConfirm] = useState<FigureCommand>();
  const [association, setAssociation] = useState<{ sourceId: string; role: 'panel' | 'shared' }[]>();
  const [filter, setFilter] = useState('all');
  const [directory, setDirectory] = useState('figures');
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [leftWidth, setLeftWidth] = useState(230);
  const [rightWidth, setRightWidth] = useState(350);
  const [zoom, setZoom] = useState(1);
  const [ai, setAi] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [showCandidate, setShowCandidate] = useState(true);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<FigureCommand>();
  const [original, setOriginal] = useState(false);
  useEffect(() => {
    session.load().catch((cause) => setError(errorMessage(cause)));
    registerLeaveGuard?.(() => session.leave());
    return () => {
      registerLeaveGuard?.();
      session.close();
    };
  }, [session, registerLeaveGuard]);
  const data = state.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 项目文件不可变，切分版本变化不重建 PDF 资源。
  useEffect(() => {
    if (!data) return;
    const resource = createReviewResources(data);
    setResources(resource);
    return () => resource.dispose();
  }, [data?.project.id]);
  useEffect(() => {
    if (!data) return;
    if (!regionId || !data.paper.figures.some((figure) => figure.regions.some((region) => region.id === regionId))) {
      setRegionId(data.paper.figures[0]?.regions[0]?.id);
      setPanelId(undefined);
    }
  }, [data, regionId]);
  async function act(work: () => Promise<unknown>) {
    try {
      await work();
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function commit(command: FigureCommand) {
    try {
      await session.save(command);
      setFailed(undefined);
      // A newer text draft during a save must remain protected and visible.
      if (!session.snapshot().dirty) {
        setDraft(undefined);
        setLabel(undefined);
        setTitle(undefined);
        setAssociation(undefined);
      }
      setError('');
      if (command.kind === 'add-figure' && resources && settings.apiKey) {
        setRecognizing(true);
        void supplementReviewRegion({ session, command, resources, settings })
          .catch((cause) => {
            if (!(cause instanceof DOMException && cause.name === 'AbortError'))
              setError('新增整图已保存；自动补充子图未完成，可通过“重新识别当前图”重试。');
          })
          .finally(() => setRecognizing(false));
      }
      return true;
    } catch (cause) {
      setFailed(command);
      setError(errorMessage(cause));
      return false;
    }
  }
  function cancel() {
    void act(async () => {
      await session.discard();
      setDraft(undefined);
      setLabel(undefined);
      setTitle(undefined);
      setAssociation(undefined);
      setMoveConfirm(undefined);
      setFailed(undefined);
    });
  }
  function select(nextRegion: string, nextPanel?: string) {
    if (state.dirty && (nextRegion !== regionId || nextPanel !== panelId)) {
      setError('请先保存或取消当前编辑。');
      return;
    }
    setRegionId(nextRegion);
    setPanelId(nextPanel);
    setOriginal(false);
    setViewed((previous) => new Set([...previous, nextRegion]));
  }
  function jump(nextRegion: string, nextPanel?: string) {
    select(nextRegion, nextPanel);
    document.getElementById(`region-${nextRegion}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (!data || !resources) return { ready: false as const, error, session, act };
  const { paper, project } = data;
  const current =
    regionId && paper.figures.some((figure) => figure.regions.some((region) => region.id === regionId))
      ? regionIn(paper, regionId)
      : undefined;
  const panel = current?.region.panels.find((item) => item.id === panelId);
  const source = panel ? paper.sources.find((item) => item.id === panel.sourceId)! : current?.source;
  const previewBox = draft && draft.regionId === regionId ? draft.bbox : source?.bbox;
  const confirmed = !state.dirty && paper.figureReview.confirmedRevision === paper.figureReview.revision;
  const manual = (figureId: string) =>
    paper.figures
      .find((figure) => figure.id === figureId)!
      .regions.some(
        (region) =>
          paper.sources.some(
            (source) =>
              (source.id === region.sourceId || region.panels.some((panel) => panel.sourceId === source.id)) &&
              source.geometryOrigin === 'manual',
          ) || region.panels.some((panel) => panel.labelOrigin === 'manual'),
      );
  const concerns = (figureId: string) => {
    const figure = paper.figures.find((figure) => figure.id === figureId)!;
    const panels = figure.regions.flatMap((region) => region.panels);
    const labels = panels.flatMap((panel) => (panel.label ? [panel.label] : []));
    return [
      ...captionLabels(figure.caption ?? '')
        .filter((expected) => !labels.some((label) => label.toUpperCase() === expected))
        .map((label) => `图注提及 ${label}，尚无对应 Panel`),
      ...(!panels.length ? ['未检测到 Panel，可使用整图或手动补图'] : []),
      ...(new Set(labels).size !== labels.length ? ['存在重复标签，请核对归属'] : []),
      ...panels.flatMap((panel) => [
        ...(!panel.label ? ['存在未标号 Panel'] : []),
        ...(panel.captionAssociation?.status !== 'linked' ? [`${panel.label || 'Panel'} 关联尚不明确`] : []),
        ...(panel.description?.includes('边缘经过内容') ? [`${panel.label || 'Panel'} 边缘或共享标注需核对`] : []),
      ]),
    ];
  };
  const figures = paper.figures.filter(
    (figure) => filter === 'all' || (filter === 'manual' ? manual(figure.id) : concerns(figure.id).length > 0),
  );
  const candidatePaper = state.candidate && showCandidate ? state.candidate.paper : undefined;
  const captions = current ? paper.sources.filter((item) => current.figure.captionSourceIds?.includes(item.id)) : [];
  const associated = panel?.captionAssociation?.links ?? [];
  const captionSources = panel
    ? captions.filter((source) => associated.some((link) => link.sourceId === source.id))
    : captions;
  const evidence = source
    ? paper.evidences.filter(
        (item) =>
          item.sourceIds.includes(source.id) ||
          item.sourceIds.some((id) => associated.some((link) => link.sourceId === id)),
      )
    : [];
  const impact = current
    ? figureConsumers(state.consumers ?? [], [
        current.region.sourceId,
        ...current.region.panels.map((panel) => panel.sourceId),
      ])
    : [];
  const busy = state.saving;
  async function saveTitle() {
    if (!title) return;
    try {
      const destination = resolveFigureDestination(paper, title.value, title.selectedId);
      const command: FigureCommand = title.regionId
        ? { kind: 'move-region', regionId: title.regionId, destination, id: crypto.randomUUID() }
        : {
            kind: 'add-figure',
            documentId: title.documentId,
            pageNumber: title.pageNumber,
            bbox: title.bbox!,
            destination,
            id: crypto.randomUUID(),
          };
      if (
        command.kind === 'move-region' &&
        destination.kind === 'existing' &&
        destination.figureId !== regionIn(paper, title.regionId!).figure.id
      ) {
        setMoveConfirm({ ...command, confirmed: true });
      } else await commit(command);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  function startTitle(editRegion?: string) {
    if (state.dirty) {
      setError('请先完成当前编辑。');
      return;
    }
    const selected = editRegion ? regionIn(paper, editRegion) : undefined;
    setTitle({
      regionId: editRegion,
      value: selected?.figure.label ?? '',
      selectedId: selected?.figure.id,
      documentId: selected?.source.documentId ?? paper.documents[0].id,
      pageNumber: selected?.source.pageNumber ?? 1,
    });
  }
  function retry() {
    if (title) {
      void saveTitle();
      return;
    }
    if (label !== undefined && current && panel && mode !== 'panel') {
      void commit({ kind: 'label', regionId: current.region.id, panelId: panel.id, label });
      return;
    }
    if (failed) void commit(failed);
  }
  return {
    ready: true as const,
    retry,
    session,
    state,
    resources,
    data,
    regionId,
    setRegionId,
    panelId,
    setPanelId,
    draft,
    setDraft,
    mode,
    setMode,
    label,
    setLabel,
    title,
    setTitle,
    moveConfirm,
    setMoveConfirm,
    association,
    setAssociation,
    filter,
    setFilter,
    directory,
    setDirectory,
    viewed,
    setViewed,
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    zoom,
    setZoom,
    ai,
    setAi,
    recognizing,
    setRecognizing,
    showCandidate,
    setShowCandidate,
    error,
    setError,
    failed,
    setFailed,
    original,
    setOriginal,
    act,
    commit,
    cancel,
    select,
    jump,
    paper,
    project,
    current,
    panel,
    source,
    previewBox,
    confirmed,
    manual,
    concerns,
    figures,
    candidatePaper,
    captions,
    associated,
    captionSources,
    evidence,
    busy,
    impact,
    saveTitle,
    startTitle,
  };
}
export type FigureReviewController = Extract<ReturnType<typeof useFigureReview>, { ready: true }>;
