import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type RegisterLeaveGuard, setDirty } from '../../app/activity';
import { analysisService, modelScheduler } from '../../app/composition';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { getAnalysisProgress, isSelected, selectionImpact, unitComplete } from '../../modules/paper/analysisUnits';
import type { FigurePageSelection, Paper } from '../../modules/paper/model';
import type { WorkspaceStep } from '../../modules/project/model';
import { errorMessage } from '../controls';

type Target = { documentId: string; pageNumber: number };
type PendingSelection = Target & {
  manualOverride?: 'include' | 'exclude';
  expectedRevision: number;
  impact: ReturnType<typeof selectionImpact>;
};
export type PageFilter = 'all' | 'selected' | 'unselected' | 'pending';
const locations = new Map<string, { document: string; filter: PageFilter; selected?: Target; scrollTop: number }>();

export function pageSelectionLabel(selection?: FigurePageSelection) {
  if (selection?.manualOverride === 'include') return '人工加入';
  if (selection?.manualOverride === 'exclude') return '人工排除';
  if (!selection || selection.automatic === 'pending') return '待分析';
  return selection.automatic === 'detected' ? '自动发现' : '未发现';
}
export function pageProcessingLabel(paper: Paper, target: Target) {
  if (!unitComplete(paper, 'text', { ...target, kind: 'page' })) return '待提取文本';
  if (!unitComplete(paper, 'figure-discovery', { ...target, kind: 'page' })) return '待发现图源';
  const selection = paper.figurePageSelections.find(
    (page) => page.documentId === target.documentId && page.pageNumber === target.pageNumber,
  );
  if (selection && isSelected(selection)) {
    if (!unitComplete(paper, 'figure-location', { ...target, kind: 'page' })) return '图源待处理';
    const unit = paper.analysisUnits.find(
      (item) =>
        item.stage === 'figure-location' &&
        item.target.kind === 'page' &&
        item.target.documentId === target.documentId &&
        item.target.pageNumber === target.pageNumber,
    );
    if (unit?.outcome === 'no-figure-located') return '尚未定位整图，下一步核对';
  }
  if (!unitComplete(paper, 'evidence', { ...target, kind: 'page' })) return '证据待整理';
  return '已保存';
}

export function usePaperAnalysis({
  id,
  settings,
  registerLeaveGuard,
  onLegacyStep,
}: {
  id: string;
  settings: ModelSettings;
  registerLeaveGuard?: RegisterLeaveGuard;
  onLegacyStep?: (step: 'slides' | 'outline-speech') => void;
}) {
  const session = analysisService.session(id);
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot);
  const scheduler = useSyncExternalStore(modelScheduler.subscribe, modelScheduler.snapshot);
  const previousLocation = locations.get(id);
  const [documentFilter, setDocumentFilter] = useState(previousLocation?.document ?? 'all');
  const [pageFilter, setPageFilter] = useState<PageFilter>(previousLocation?.filter ?? 'all');
  const [selectedPage, setSelectedPage] = useState<Target | undefined>(previousLocation?.selected);
  const [step, setStep] = useState<'paper-analysis' | 'figure-review'>('paper-analysis');
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const [saveStatus, setSaveStatus] = useState('已保存');
  const [saving, setSaving] = useState(false);
  const [requirementsReady, setRequirementsReady] = useState(false);
  const [failedSelection, setFailedSelection] = useState<Omit<PendingSelection, 'impact'>>();
  const [pendingSelection, setPendingSelection] = useState<PendingSelection>();
  const [selectionSaving, setSelectionSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const instructionRef = useRef('');
  const savedInstruction = useRef('');
  const composing = useRef(false);
  const savePromise = useRef<Promise<void> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  const selectionBusy = useRef(false);
  const failedSelectionRef = useRef<Omit<PendingSelection, 'impact'> | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const paper = snapshot.data?.paper;
  const progress = paper ? getAnalysisProgress(paper) : undefined;

  useEffect(() => {
    session.configure(settings);
  }, [session, settings]);
  useEffect(() => {
    let active = true;
    session.load().catch((cause) => {
      if (active) setError(errorMessage(cause));
    });
    return () => {
      active = false;
    };
  }, [session]);
  useEffect(() => {
    const data = snapshot.data;
    if (!data || ready.current) return;
    instructionRef.current = data.project.preferences.instruction;
    savedInstruction.current = instructionRef.current;
    setInstruction(instructionRef.current);
    ready.current = true;
    setRequirementsReady(true);
    if (data.project.lastOpenedStep === 'figure-review') setStep('figure-review');
    requestAnimationFrame(() => {
      if (list.current) list.current.scrollTop = locations.get(id)?.scrollTop ?? 0;
    });
  }, [snapshot.data, id]);
  useEffect(() => {
    if (snapshot.status !== 'running') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [snapshot.status]);
  useEffect(() => {
    if (selectedPage || !paper?.documents.length) return;
    const document = paper.documents[0];
    if (document.pageCount) setSelectedPage({ documentId: document.id, pageNumber: 1 });
  }, [paper, selectedPage]);
  useEffect(() => {
    const previous = locations.get(id);
    locations.set(id, {
      document: documentFilter,
      filter: pageFilter,
      selected: selectedPage,
      scrollTop: previous?.scrollTop ?? 0,
    });
  }, [id, documentFilter, pageFilter, selectedPage]);

  const saveRequirements = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (composing.current) throw new Error('请先完成正在输入的文字。');
    if (savePromise.current) return savePromise.current;
    if (!ready.current || instructionRef.current === savedInstruction.current) return;
    const save = (async () => {
      setSaving(true);
      try {
        while (instructionRef.current !== savedInstruction.current) {
          if (composing.current) {
            throw new Error('请先完成正在输入的文字。');
          }
          const value = instructionRef.current;
          setSaveStatus('正在保存…');
          await session.saveRequirements(value);
          savedInstruction.current = value;
        }
        setSaveStatus('已保存');
        setDirty(`paper-requirements:${id}`, false);
      } catch (cause) {
        setSaveStatus('保存失败，输入已保留');
        throw cause;
      } finally {
        setSaving(false);
        savePromise.current = undefined;
      }
    })();
    savePromise.current = save;
    return save;
  }, [id, session]);
  useEffect(() => {
    registerLeaveGuard?.(async () => {
      if (selectionBusy.current) throw new Error('图源页选择正在保存，请稍后再离开。');
      if (failedSelectionRef.current) throw new Error('图源页选择尚未保存，请先重试或撤销未保存选择。');
      await saveRequirements();
    });
    return () => {
      registerLeaveGuard?.();
      if (timer.current) clearTimeout(timer.current);
      setDirty(`paper-requirements:${id}`, false);
      setDirty(`paper-selection:${id}`, false);
    };
  }, [id, registerLeaveGuard, saveRequirements]);
  function queueSave() {
    if (timer.current) clearTimeout(timer.current);
    if (!composing.current)
      timer.current = setTimeout(() => {
        void saveRequirements().catch(() => {});
      }, 650);
  }
  function changeInstruction(value: string) {
    instructionRef.current = value;
    setInstruction(value);
    const dirty = value !== savedInstruction.current;
    setDirty(`paper-requirements:${id}`, dirty);
    setSaveStatus(dirty ? '未保存' : '已保存');
    queueSave();
  }
  async function navigate(next: WorkspaceStep) {
    try {
      if (selectionBusy.current) throw new Error('图源页选择正在保存，请稍后再切换。');
      await saveRequirements();
      if (failedSelection) throw new Error('图源页选择尚未保存，请先重试该选择。');
      await session.openStep(next);
      setError('');
      if (next === 'paper-analysis' || next === 'figure-review') setStep(next);
      else onLegacyStep?.(next);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function start() {
    try {
      await saveRequirements();
      setError('');
      void session.start(settings).catch((cause) => setError(errorMessage(cause)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function applySelection(input: Omit<PendingSelection, 'impact'>, confirmed = false) {
    if (selectionBusy.current) return;
    selectionBusy.current = true;
    setDirty(`paper-selection:${id}`, true);
    setSelectionSaving(true);
    try {
      await session.select({ ...input, confirmRemoval: confirmed });
      setPendingSelection(undefined);
      failedSelectionRef.current = undefined;
      setFailedSelection(undefined);
      setDirty(`paper-selection:${id}`, false);
      setError('');
    } catch (cause) {
      failedSelectionRef.current = input;
      setFailedSelection(input);
      setError(errorMessage(cause));
    } finally {
      selectionBusy.current = false;
      setSelectionSaving(false);
    }
  }
  function select(target: Target, manualOverride?: 'include' | 'exclude') {
    if (!paper || selectionBusy.current) return;
    const selection = paper.figurePageSelections.find(
      (page) => page.documentId === target.documentId && page.pageNumber === target.pageNumber,
    );
    if (!selection) return;
    const input = { ...target, manualOverride, expectedRevision: selection.revision };
    const selected =
      manualOverride === 'include' || (manualOverride !== 'exclude' && selection.automatic === 'detected');
    const impact = selectionImpact(paper, target.documentId, target.pageNumber);
    if (!selected && impact.sourceIds.length) setPendingSelection({ ...input, impact });
    else void applySelection(input);
  }
  function discardSelection() {
    if (selectionBusy.current) return;
    failedSelectionRef.current = undefined;
    setFailedSelection(undefined);
    setPendingSelection(undefined);
    setDirty(`paper-selection:${id}`, false);
    setError('');
  }
  async function reload() {
    try {
      await session.load();
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  const elapsedMs =
    snapshot.status === 'running' && snapshot.startedAt ? Math.max(0, now - snapshot.startedAt) : snapshot.elapsedMs;
  return {
    session,
    snapshot,
    scheduler,
    progress,
    paper,
    error,
    setError,
    instruction,
    saving,
    saveStatus,
    changeInstruction,
    saveRequirements,
    requirementsReady,
    failedSelection,
    discardSelection,
    reload,
    retrySelection: () => {
      if (failedSelection) void applySelection(failedSelection, !!pendingSelection);
    },
    onCompositionStart: () => {
      composing.current = true;
      if (timer.current) clearTimeout(timer.current);
    },
    onCompositionEnd: () => {
      composing.current = false;
      queueSave();
    },
    documentFilter,
    setDocumentFilter,
    pageFilter,
    setPageFilter,
    selectedPage,
    setSelectedPage,
    step,
    navigate,
    start,
    select,
    pendingSelection,
    setPendingSelection,
    selectionSaving,
    confirmSelection: () => {
      if (pendingSelection) void applySelection(pendingSelection, true);
    },
    elapsedMs,
    list,
    rememberScroll: (scrollTop: number) => {
      const location = locations.get(id);
      if (location) location.scrollTop = scrollTop;
    },
  };
}
