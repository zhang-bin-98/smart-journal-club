import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeckSession } from '../../modules/deck/DeckSession';
import { PDF_EXPORT_EDGE } from '../../shared/pdf/pdfResource';
import { captureVersion, restorePrevious, saveRevision } from '../../modules/deck/deckRepository';
import { loadProject, updateProject, type ProjectData } from '../../modules/project/projectRepository';
import { figureImage } from '../../modules/paper/sources';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../../app/activity';
import { generateProject } from '../../modules/generation/runGeneration';
import { regenerateProject } from '../../modules/generation/regenerateDeck';
import type { ModelSettings } from '../../shared/llm/model';
import type { Project } from '../../modules/project/project.schema';
import type { Deck, Element } from '../../modules/deck/deck.schema';
import type { PersistAssistantRevision } from '../../modules/assistant/revision/applyRevision';
import { errorMessage } from '../controls';
import type { SourceSelection } from '../SourceDialog';
import type { OpenProject } from './useProjectWorkspace';

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
  const [warning, setWarning] = useState('');
  const [regeneration, setRegeneration] = useState(false);
  const [operationKind, setOperationKind] = useState<'generate' | 'regenerate' | 'restore'>();
  const dataRef = useRef(data);
  dataRef.current = data;
  const instructionRef = useRef(instruction);
  const preferenceSave = useRef<Promise<Project> | undefined>(undefined);
  const editorLeave = useRef<LeaveGuard | undefined>(undefined);
  const registerEditorLeave = useCallback((guard?: LeaveGuard) => {
    editorLeave.current = guard;
  }, []);
  const preferenceKey = `preferences-${data.project.id}`;
  const dialogKey = `project-dialog-${data.project.id}`;
  const parseTask = useRef<AbortController | undefined>(undefined);
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
    if (source || regeneration) throw new Error('请先应用或取消当前对话框中的操作');
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
      if (session) {
        const initial = { ...dataRef.current, deck: session.current };
        const next = await regenerateProject(
          initial,
          { ...initial.project.preferences, instruction: nextInstruction ?? initial.project.preferences.instruction },
          settings,
          signal,
          (label) => {
            if (current()) setStage(label);
          },
          (message) => {
            if (current()) setWarning(message);
          },
          current,
        );
        if (!controller.signal.aborted) acceptData(next);
      } else {
        const project = await savePreferences();
        await generateProject(
          { ...dataRef.current, project },
          resource!,
          settings,
          signal,
          (label) => {
            if (current()) setStage(label);
          },
          (saved) => {
            if (!controller.signal.aborted) acceptData(saved);
          },
          (message) => {
            if (current()) setWarning(message);
          },
        );
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
      if (!controller.signal.aborted) acceptData({ ...dataRef.current, ...result, plan: undefined });
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
    warning,
    operationKind,
    session,
    image,
    persistRevision,
    generate,
    restore,
    cancelTask,
    exportPresentation,
    registerEditorLeave,
    resource,
  };
}
