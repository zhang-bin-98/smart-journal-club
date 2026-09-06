import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeckSession } from '../../modules/deck/DeckSession';
import { PDF_EXPORT_EDGE } from '../../shared/pdf/pdfResource';
import { captureVersion, restorePrevious, saveRevision } from '../../modules/deck/deckRepository';
import { loadProject, updateProject, type ProjectData } from '../../modules/project/projectRepository';
import { figureImage } from '../../modules/paper/sources';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../../app/activity';
import {
  buildPresentation,
  prepareOutline,
  preparePaper,
  reanalyzePaper,
} from '../../modules/generation/runGeneration';
import { discardCandidate } from '../../modules/generation/candidateRepository';
import { createReanalysisProject } from '../../modules/project/reanalysisRepository';
import type { ModelSettings } from '../../shared/llm/model';
import type { Project } from '../../modules/project/project.schema';
import type { Deck, Element } from '../../modules/deck/deck.schema';
import type { PersistAssistantRevision } from '../../modules/assistant/revision/applyRevision';
import { errorMessage } from '../controls';
import type { SourceSelection } from '../SourceDialog';
import type { OpenProject } from './useProjectWorkspace';
import { OutlineSession } from '../../modules/outline/OutlineSession';
import { savePlanRevision } from '../../modules/outline/outlineRepository';
import { validatePlanNarrative } from '../../modules/outline/validateNarrative';
import type { PlanMutation } from '../../modules/outline/outline.schema';

/** 项目工作区控制器：Deck 会话与修订持久化、偏好保存队列、生成/重生成/恢复/导出任务及对话框状态。 */
export function useProjectController(
  opened: OpenProject,
  settings: ModelSettings,
  online: boolean,
  registerLeaveGuard?: RegisterLeaveGuard,
) {
  const { resource, controller } = opened;
  const [data, setData] = useState(opened.data);
  const [instruction, setInstruction] = useState(data.project.preferences.instruction);
  const [source, setSource] = useState<SourceSelection>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [regeneration, setRegeneration] = useState(false);
  const [reanalysis, setReanalysis] = useState(false);
  const [operationKind, setOperationKind] = useState<'generate' | 'regenerate' | 'restore' | 'reanalysis'>();
  const dataRef = useRef(data);
  dataRef.current = data;
  const instructionRef = useRef(instruction);
  const preferenceSave = useRef<Promise<Project> | undefined>(undefined);
  const editorLeave = useRef<LeaveGuard | undefined>(undefined);
  const outlineLeave = useRef<LeaveGuard | undefined>(undefined);
  const registerOutlineLeave = useCallback((guard?: LeaveGuard) => {
    outlineLeave.current = guard;
  }, []);
  const registerEditorLeave = useCallback((guard?: LeaveGuard) => {
    editorLeave.current = guard;
  }, []);
  const preferenceKey = `preferences-${data.project.id}`;
  const dialogKey = `project-dialog-${data.project.id}`;
  const parseTask = useRef<AbortController | undefined>(undefined);
  const outlineRef = useRef<OutlineSession | undefined>(undefined);
  if (data.plan && outlineRef.current?.current.id !== data.plan.id)
    outlineRef.current = new OutlineSession(data.plan, data.paper, data.project.id, savePlanRevision);
  if (!data.plan) outlineRef.current = undefined;
  const outlineIssues = data.plan
    ? validatePlanNarrative({ ...data.plan, status: 'confirmed', confirmedAt: Date.now() }, data.paper)
    : undefined;
  const persistRevision: PersistAssistantRevision = (previous, next, record, options, messages) =>
    saveRevision(
      data.project.id,
      previous,
      next,
      record,
      options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      { isTaskActive: options?.isTaskActive, messages },
    );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 会话仅随 deck/paper/项目标识/任务控制器重建，persistRevision 每次渲染新建是有意的
  const session = useMemo(
    () =>
      data.deck
        ? new DeckSession(
            data.deck,
            data.paper,
            (previous, next, record, options) => persistRevision(previous, next, record, options),
            data.project.id,
          )
        : undefined,
    [data.deck, data.paper, data.project.id, controller],
  );
  const image = useMemo(
    () => async (element: Extract<Element, { type: 'figure' }>) => {
      if (!resource) throw new Error('原 PDF 缺失');
      return figureImage(resource, data.paper, element, element.cropOverride);
    },
    [resource, data.paper],
  );
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => {
    if (parseTask.current) throw new Error('请先完成或取消当前任务');
    if (source || regeneration || reanalysis) throw new Error('请先应用或取消当前对话框中的操作');
    await outlineLeave.current?.();
    if (session) await editorLeave.current?.();
    else await savePreferences();
  };
  useEffect(() => {
    registerLeaveGuard?.(() => leave.current());
    return () => registerLeaveGuard?.();
  }, [registerLeaveGuard]);
  useEffect(
    () => () => {
      parseTask.current?.abort();
      setDirty(preferenceKey, false);
      setDirty(dialogKey, false);
    },
    [preferenceKey, dialogKey],
  );
  function openSource(next?: SourceSelection) {
    setDirty(dialogKey, !!next);
    setSource(next);
  }
  function openRegeneration(value: boolean) {
    setDirty(dialogKey, value);
    setRegeneration(value);
  }
  function openReanalysis(value: boolean) {
    setDirty(dialogKey, value);
    setReanalysis(value);
  }
  function changeInstruction(value: string) {
    instructionRef.current = value;
    setInstruction(value);
    setDirty(preferenceKey, value !== dataRef.current.project.preferences.instruction);
  }
  function commitInstruction() {
    void savePreferences().catch((cause) => setError(errorMessage(cause)));
  }
  async function savePreferences(): Promise<Project> {
    if (preferenceSave.current) {
      await preferenceSave.current;
      return savePreferences();
    }
    const current = dataRef.current.project,
      value = instructionRef.current;
    if (value === current.preferences.instruction) return current;
    const done = beginActivity();
    const save = updateProject(current.id, { preferences: { ...current.preferences, instruction: value } });
    preferenceSave.current = save;
    try {
      const project = await save;
      if (!controller.signal.aborted) {
        dataRef.current = { ...dataRef.current, project };
        setData(dataRef.current);
        setDirty(preferenceKey, instructionRef.current !== project.preferences.instruction);
      }
      return instructionRef.current !== value ? await savePreferencesAfter(save) : project;
    } finally {
      if (preferenceSave.current === save) preferenceSave.current = undefined;
      done();
    }
  }
  async function savePreferencesAfter(save: Promise<Project>) {
    if (preferenceSave.current === save) preferenceSave.current = undefined;
    return savePreferences();
  }
  function acceptData(next: ProjectData) {
    dataRef.current = next;
    setData(next);
    instructionRef.current = next.project.preferences.instruction;
    setInstruction(instructionRef.current);
    setDirty(preferenceKey, false);
  }
  async function generate(nextInstruction?: string) {
    if (parseTask.current || !online || !settings.apiKey.trim() || (!session && !resource)) return;
    const task = new AbortController();
    const done = beginActivity();
    parseTask.current = task;
    setBusy(true);
    setError('');
    setOperationKind(session ? 'regenerate' : 'generate');
    const signal = AbortSignal.any([controller.signal, task.signal]);
    const current = () => !signal.aborted && parseTask.current === task;
    openRegeneration(false);
    try {
      if (dataRef.current.plan) {
        const next = await buildPresentation(dataRef.current, settings, signal, (label) => {
          if (current()) setStage(label);
        });
        if (!controller.signal.aborted) acceptData(next);
      } else if (session) {
        const initial = { ...dataRef.current, deck: session.current };
        const next = await prepareOutline(
          initial,
          settings,
          signal,
          (label) => {
            if (current()) setStage(label);
          },
          { ...initial.project.preferences, instruction: nextInstruction ?? initial.project.preferences.instruction },
        );
        if (!controller.signal.aborted) acceptData(next);
      } else {
        const project = await savePreferences();
        const initial = { ...dataRef.current, project };
        const onStage = (label: string) => {
          if (current()) setStage(label);
        };
        let next: ProjectData;
        switch (initial.project.checkpoint) {
          case 'paper-ready':
            next = await prepareOutline(initial, settings, signal, onStage);
            break;
          case 'deck-plan-ready':
            next = await buildPresentation(initial, settings, signal, onStage);
            break;
          default:
            next = await preparePaper(initial, resource!, settings, signal, onStage, (saved) => {
              if (!controller.signal.aborted) acceptData(saved);
            });
        }
        if (!controller.signal.aborted) acceptData(next);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          task.signal.aborted
            ? session
              ? '已取消重生成，当前版和上一版均保留。'
              : '已停止，完整阶段已保存，可继续生成。'
            : errorMessage(cause),
        );
    } finally {
      done();
      if (parseTask.current === task) {
        parseTask.current = undefined;
        if (!controller.signal.aborted) {
          setBusy(false);
          setOperationKind(undefined);
        }
      }
    }
  }
  async function reanalyze(nextInstruction: string) {
    if (parseTask.current || !resource || !online || !settings.apiKey.trim()) return;
    const task = new AbortController();
    parseTask.current = task;
    const done = beginActivity();
    setBusy(true);
    setError('');
    setStage('重新理解研究内容');
    setOperationKind('reanalysis');
    openReanalysis(false);
    try {
      await outlineLeave.current?.();
      await editorLeave.current?.();
      await preferenceSave.current;
      if (dataRef.current.project.currentDeckId) {
        const project = await createReanalysisProject(
          dataRef.current.project.id,
          nextInstruction,
          AbortSignal.any([controller.signal, task.signal]),
        );
        return project.id;
      }
      const next = await reanalyzePaper(
        dataRef.current,
        settings,
        AbortSignal.any([controller.signal, task.signal]),
        nextInstruction,
      );
      if (!controller.signal.aborted) acceptData(next);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(task.signal.aborted ? '已取消重新分析，原论文理解和计划均保留。' : errorMessage(cause));
    } finally {
      parseTask.current = undefined;
      if (!controller.signal.aborted) {
        setBusy(false);
        setOperationKind(undefined);
      }
      done();
    }
  }
  async function restore(deck: Deck) {
    if (parseTask.current) return;
    const task = new AbortController();
    const done = beginActivity();
    parseTask.current = task;
    setBusy(true);
    setError('');
    setOperationKind('restore');
    const signal = AbortSignal.any([controller.signal, task.signal]);
    try {
      const result = await restorePrevious(
        captureVersion(dataRef.current.project, deck),
        signal,
        () => !signal.aborted && parseTask.current === task,
      );
      if (!controller.signal.aborted) acceptData(await loadProject(result.project.id));
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      done();
      if (parseTask.current === task) {
        parseTask.current = undefined;
        if (!controller.signal.aborted) {
          setBusy(false);
          setOperationKind(undefined);
        }
      }
    }
  }
  function cancelTask() {
    parseTask.current?.abort();
  }
  async function editOutline(mutations: PlanMutation[] | 'undo' | 'redo') {
    const outline = outlineRef.current;
    if (!outline || parseTask.current || dataRef.current.candidateStale) return false;
    const task = new AbortController();
    parseTask.current = task;
    const done = beginActivity();
    setBusy(true);
    setError('');
    try {
      const options = { signal: AbortSignal.any([task.signal, controller.signal]) };
      if (mutations === 'undo' || mutations === 'redo') await outline[mutations](options);
      else await outline.commit({ ...outline.capture(), mutations }, options);
      if (controller.signal.aborted) return false;
      const plan = outline.current;
      acceptData({
        ...dataRef.current,
        plan,
        planRecord: dataRef.current.planRecord ? { ...dataRef.current.planRecord, plan } : undefined,
      });
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
      return false;
    } finally {
      if (parseTask.current === task) parseTask.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
      done();
    }
  }
  async function confirmOutline(warningsAccepted: boolean) {
    const outline = outlineRef.current;
    if (!outline || parseTask.current) return;
    const task = new AbortController();
    parseTask.current = task;
    const done = beginActivity();
    setBusy(true);
    setError('');
    try {
      await outlineLeave.current?.();
      const signal = AbortSignal.any([task.signal, controller.signal]);
      const plan = await outline.confirm(outline.capture(), { signal, warningsAccepted });
      if (!controller.signal.aborted) acceptData({ ...dataRef.current, plan });
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (parseTask.current === task) parseTask.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
      done();
    }
  }
  async function discardOutline() {
    const plan = dataRef.current.plan;
    if (!plan || parseTask.current) return;
    try {
      await discardCandidate(dataRef.current.project.id, plan.id, plan.revision);
      acceptData({ ...dataRef.current, plan: undefined, planRecord: undefined, candidateStale: false });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function refreshOutline() {
    if (parseTask.current) return false;
    try {
      await outlineLeave.current?.();
      await editorLeave.current?.();
      await savePreferences();
      const latest = await loadProject(dataRef.current.project.id);
      if (controller.signal.aborted) return false;
      if (latest.plan && outlineRef.current?.current.revision !== latest.plan.revision)
        outlineRef.current = new OutlineSession(latest.plan, latest.paper, latest.project.id, savePlanRevision);
      acceptData({
        ...latest,
        deck:
          latest.deck?.id === session?.current.id && latest.deck?.revision === session?.current.revision
            ? session
              ? structuredClone(session.current)
              : latest.deck
            : latest.deck,
      });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }
  async function exportPresentation(deck: Deck) {
    if (!resource && deck.slides.some((slide) => slide.elements.some((element) => element.type === 'figure')))
      throw new Error('原 PDF 缺失，无法导出图源');
    const { exportDeck, downloadDeck } = await import('../../modules/deck/export');
    const blob = await exportDeck(
      deck,
      data.paper,
      (element) => figureImage(resource!, data.paper, element, element.cropOverride, PDF_EXPORT_EDGE),
      controller.signal,
    );
    await loadProject(data.project.id);
    controller.signal.throwIfAborted();
    downloadDeck(blob, data.project.name);
  }
  return {
    data,
    instruction,
    changeInstruction,
    commitInstruction,
    source,
    openSource,
    regeneration,
    openRegeneration,
    error,
    busy,
    stage,
    operationKind,
    session,
    image,
    persistRevision,
    generate,
    reanalyze,
    reanalysis,
    openReanalysis,
    confirmOutline,
    discardOutline,
    refreshOutline,
    outlineIssues,
    editOutline,
    registerOutlineLeave,
    outlineCanUndo: outlineRef.current?.canUndo ?? false,
    outlineCanRedo: outlineRef.current?.canRedo ?? false,
    restore,
    cancelTask,
    exportPresentation,
    registerEditorLeave,
    resource,
  };
}
