import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Circle, FileText, LoaderCircle, Play, Settings, X } from 'lucide-react';
import { DeckSession } from '../deck';
import { PdfResource, PDF_EXPORT_EDGE } from '../pdf';
import { captureVersion, restorePrevious, saveRevision } from '../modules/deck/deckRepository';
import { loadProject, updateProject, type ProjectData } from '../modules/project/projectRepository';
import { Brand, Button, errorMessage, IconButton, inputClass, useOnline } from './controls';
import { Editor } from './editor/Editor';
import { SourceDialog, type SourceSelection } from './SourceDialog';
import type { ModelSettings } from '../model';
import { Checkpoints, type Project } from '../modules/project/project.schema';
import type { Deck } from '../modules/deck/deck.schema';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../activity';
import { generateProject, regenerateProject, GENERATION_STEPS } from '../generation';

type OpenProject = { data: ProjectData; resource?: PdfResource; controller: AbortController };
export function ProjectPage({ id, onLeave, settings, onSettings, registerLeaveGuard }: { id: string; onLeave: () => void; settings: ModelSettings; onSettings: () => void; registerLeaveGuard?: RegisterLeaveGuard }) {
  const [opened, setOpened] = useState<OpenProject>();
  const [error, setError] = useState('');
  useEffect(() => {
    const done = beginActivity(); const controller = new AbortController(); let resource: PdfResource | undefined;
    setOpened(undefined); setError('');
    loadProject(id).then(data => {
      if (controller.signal.aborted) return;
      if (data.asset) resource = new PdfResource(data.asset.blob);
      setOpened({ data, resource, controller });
    }, cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); }).finally(done);
    return () => { controller.abort(); void resource?.dispose().catch(() => {}); };
  }, [id]);
  if (opened) return <ProjectContent key={id} opened={opened} onLeave={onLeave} settings={settings} onSettings={onSettings} registerLeaveGuard={registerLeaveGuard} />;
  return <main className="mx-auto max-w-[1000px] p-6"><Button onClick={onLeave}><ArrowLeft size={16} />返回首页</Button><p role={error ? 'alert' : 'status'} className="mt-8 text-sm">{error || '正在打开项目…'}</p></main>;
}

function ProjectContent({ opened, onLeave, settings, onSettings, registerLeaveGuard }: { opened: OpenProject; onLeave: () => void; settings: ModelSettings; onSettings: () => void; registerLeaveGuard?: RegisterLeaveGuard }) {
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
  const online = useOnline();
  const dataRef = useRef(data); dataRef.current = data;
  const instructionRef = useRef(instruction);
  const preferenceSave = useRef<Promise<Project> | undefined>(undefined);
  const editorLeave = useRef<LeaveGuard | undefined>(undefined);
  const registerEditorLeave = useCallback((guard?: LeaveGuard) => { editorLeave.current = guard; }, []);
  const preferenceKey = `preferences-${data.project.id}`;
  const dialogKey = `project-dialog-${data.project.id}`;
  const parseTask = useRef<AbortController | undefined>(undefined);
  const session = useMemo(() => data.deck ? new DeckSession(data.deck, data.paper, (previous, next, record, options) => saveRevision(data.project.id, previous, next, record, options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal, { isTaskActive: options?.isTaskActive, messages: options?.messages }), data.project.id) : undefined, [data.deck, data.paper, data.project.id, controller]);
  const image = useMemo(() => async (element: Parameters<PdfResource['image']>[1]) => {
    if (!resource) throw new Error('原 PDF 缺失'); return resource.image(data.paper, element);
  }, [resource, data.paper]);
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => {
    if (parseTask.current) throw new Error('请先完成或取消当前任务');
    if (source || regeneration) throw new Error('请先应用或取消当前对话框中的操作');
    if (session) await editorLeave.current?.(); else await savePreferences();
  };
  useEffect(() => { registerLeaveGuard?.(() => leave.current()); return () => registerLeaveGuard?.(); }, [registerLeaveGuard]);
  useEffect(() => () => { parseTask.current?.abort(); setDirty(preferenceKey, false); setDirty(dialogKey, false); }, [preferenceKey, dialogKey]);
  function openSource(next?: SourceSelection) { setDirty(dialogKey, !!next); setSource(next); }
  function openRegeneration(value: boolean) { setDirty(dialogKey, value); setRegeneration(value); }
  async function savePreferences(): Promise<Project> {
    if (preferenceSave.current) { await preferenceSave.current; return savePreferences(); }
    const current = dataRef.current.project, value = instructionRef.current;
    if (value === current.preferences.instruction) return current;
    const done = beginActivity();
    const save = updateProject(current.id, { preferences: { ...current.preferences, instruction: value } }); preferenceSave.current = save;
    try {
      const project = await save;
      if (!controller.signal.aborted) { dataRef.current = { ...dataRef.current, project }; setData(dataRef.current); setDirty(preferenceKey, instructionRef.current !== project.preferences.instruction); }
      return instructionRef.current !== value ? await savePreferencesAfter(save) : project;
    } finally { if (preferenceSave.current === save) preferenceSave.current = undefined; done(); }
  }
  async function savePreferencesAfter(save: Promise<Project>) { if (preferenceSave.current === save) preferenceSave.current = undefined; return savePreferences(); }
  function acceptData(next: ProjectData) {
    dataRef.current = next; setData(next); instructionRef.current = next.project.preferences.instruction; setInstruction(instructionRef.current); setDirty(preferenceKey, false);
  }
  async function generate(nextInstruction?: string) {
    if (parseTask.current || !online || !settings.apiKey.trim() || (!session && !resource)) return;
    const task = new AbortController(); const done = beginActivity(); parseTask.current = task; setBusy(true); setError(''); setOperationKind(session ? 'regenerate' : 'generate');
    const signal = AbortSignal.any([controller.signal, task.signal]);
    const current = () => !signal.aborted && parseTask.current === task;
    openRegeneration(false);
    try {
      if (session) {
        const initial = { ...dataRef.current, deck: session.current };
        const next = await regenerateProject(initial, { ...initial.project.preferences, instruction: nextInstruction ?? initial.project.preferences.instruction }, settings, signal,
          label => { if (current()) setStage(label); }, message => { if (current()) setWarning(message); }, current);
        if (!controller.signal.aborted) acceptData(next);
      } else {
        const project = await savePreferences();
        await generateProject({ ...dataRef.current, project }, resource!, settings, signal, label => { if (current()) setStage(label); }, saved => { if (!controller.signal.aborted) acceptData(saved); }, message => { if (current()) setWarning(message); });
      }
    } catch (cause) { if (!controller.signal.aborted) setError(task.signal.aborted ? (session ? '已取消重生成，当前版和上一版均保留。' : '已停止，完整阶段已保存，可继续生成。') : errorMessage(cause)); }
    finally { done(); if (parseTask.current === task) { parseTask.current = undefined; if (!controller.signal.aborted) { setBusy(false); setOperationKind(undefined); } } }
  }
  async function restore(deck: Deck) {
    if (parseTask.current) return;
    const task = new AbortController(); const done = beginActivity(); parseTask.current = task; setBusy(true); setError(''); setOperationKind('restore');
    const signal = AbortSignal.any([controller.signal, task.signal]);
    try {
      const result = await restorePrevious(captureVersion(dataRef.current.project, deck), signal, () => !signal.aborted && parseTask.current === task);
      if (!controller.signal.aborted) acceptData({ ...dataRef.current, ...result, plan: undefined });
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { done(); if (parseTask.current === task) { parseTask.current = undefined; if (!controller.signal.aborted) { setBusy(false); setOperationKind(undefined); } } }
  }
  const completed = Checkpoints.indexOf(data.project.checkpoint);
  const content = session ? <Editor key={session.current.id} session={session} readOnly={busy} resourceAvailable={!!resource} registerLeaveGuard={registerEditorLeave} onRegenerate={() => openRegeneration(true)} onRestore={data.project.previousDeckId ? restore : undefined} taskStatus={busy ? (operationKind === 'restore' ? '正在恢复上一版…' : `正在重生成：${stage || '规划汇报结构'}…`) : undefined} onCancelTask={operationKind === 'regenerate' ? () => parseTask.current?.abort() : undefined} externalError={error} paper={data.paper} image={image} name={data.project.name} initialSlideId={data.project.lastOpenedSlideId} onLeave={onLeave} onSettings={onSettings} aiSettings={settings} aiProjectId={data.project.id} aiPreferences={data.project.preferences}
    notice={warning || '请核对主要结论、图例和裁图边缘；自动识别的图源可能需要调整。'}
    onSelection={async id => { await updateProject(data.project.id, { lastOpenedSlideId: id }); }}
    onSource={(sourceId, element, _slideId, crop, apply, onDraft) => openSource({ sourceId, element, crop, apply, onDraft })}
    onExport={async deck => {
      if (!resource && deck.slides.some(slide => slide.elements.some(element => element.type === 'figure'))) throw new Error('原 PDF 缺失，无法导出图源');
      const { exportDeck, downloadDeck } = await import('../export');
      const blob = await exportDeck(deck, data.paper, element => resource!.image(data.paper, element, PDF_EXPORT_EDGE), controller.signal);
      await loadProject(data.project.id); controller.signal.throwIfAborted();
      downloadDeck(blob, data.project.name);
    }} /> : <main className="mx-auto max-w-[1080px] px-5 py-6">
    <header className="flex items-center gap-3 border-b border-line pb-5"><IconButton label="返回首页" disabled={busy} onClick={onLeave}><ArrowLeft size={16} /></IconButton><Brand /><h1 className="min-w-0 flex-1 truncate text-sm">{data.project.name}</h1><IconButton label="模型设置" disabled={busy} onClick={onSettings}><Settings size={17} /></IconButton></header>
    <section className="mx-auto max-w-[760px] py-12">
      <p className="flex items-center gap-3 text-sm text-muted"><FileText size={20} />已保存：{data.asset?.name ?? '原 PDF 缺失'}</p>
      <label className="mt-10 block text-sm font-medium" htmlFor="instruction">你希望怎么汇报这篇论文？（可选）</label>
      <textarea id="instruction" className={`${inputClass} mt-3 min-h-36 resize-y`} placeholder="例如：中文，15 页左右，重点讲结果和创新点" value={instruction} disabled={busy || data.project.checkpoint === 'deck-plan-ready'} onChange={event => { instructionRef.current = event.target.value; setInstruction(event.target.value); setDirty(preferenceKey, event.target.value !== dataRef.current.project.preferences.instruction); }} onBlur={() => { void savePreferences().catch(cause => setError(errorMessage(cause))); }} />
      {(busy || completed > 0) && <ol className="mt-6 space-y-3 border-y border-line py-5">{GENERATION_STEPS.map((label, index) => <li key={label} className={`flex items-center gap-3 text-sm ${index < completed ? 'text-success' : index === completed ? 'text-ink' : 'text-muted'}`}>
        {index < completed ? <Check size={16} /> : busy && index === completed ? <LoaderCircle size={16} className="animate-spin" /> : <Circle size={16} />}<span>{label}</span>
      </li>)}</ol>}
      {!busy && completed > 0 && <p className="mt-4 text-sm text-muted">下次从“{GENERATION_STEPS[completed]}”继续，已完成的步骤已保存。</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {warning && <p role="status" className="mt-4 text-sm text-muted">{warning}</p>}
      {!resource && <p role="alert" className="mt-4 text-sm text-red-700">原 PDF 缺失，请保留项目中的可读内容。</p>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {busy ? <><span role="status" className="text-sm text-muted">{stage}…</span><Button onClick={() => parseTask.current?.abort()}><X size={15} />取消</Button></>
          : <>{data.paper.pages.length > 0 && <><span className="text-sm text-success">已解析 {data.paper.pages.length} 页</span><Button disabled={!resource || !data.paper.sources.length} onClick={() => openSource({ sourceId: data.paper.sources[0].id, crop: false })}><FileText size={15} />查看论文</Button></>}
            <Button primary disabled={!resource || !settings.apiKey || !online} onClick={() => void generate()}><Play size={15} />{error ? '重试当前步骤' : completed > 0 ? '继续生成' : '生成 PPT'}</Button>
          </>}
      </div>
      {!online && <p role="status" className="mt-4 text-sm text-muted">当前离线，联网后可继续生成；本地项目仍可使用。</p>}
      {!settings.apiKey && !busy && <div className="mt-4 flex items-center justify-end gap-3 text-xs text-muted"><span>尚未配置模型 Key</span><Button onClick={onSettings}>模型设置</Button></div>}
      {!!data.paper.figures.length && !busy && <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-4">{data.paper.figures.map(figure => <Button key={figure.id} onClick={() => openSource({ sourceId: figure.sourceId, crop: false })}><FileText size={14} />{figure.label ?? 'Figure'}</Button>)}</div>}
    </section>
  </main>;
  return <>{content}{source && <SourceDialog paper={data.paper} resource={resource} selection={source} readOnly={busy} onClose={() => openSource(undefined)} />}{regeneration && <RegenerateDialog instruction={data.project.preferences.instruction} disabled={!online || !settings.apiKey.trim()} onClose={() => openRegeneration(false)} onStart={value => { void generate(value); }} />}</>;
}

function RegenerateDialog({ instruction, disabled, onClose, onStart }: { instruction: string; disabled: boolean; onClose: () => void; onStart: (instruction: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(instruction);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} aria-label="重新生成整套 PPT" onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto w-[min(600px,94vw)] max-w-none rounded-md border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-black/35">
    <header className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">重新生成整套 PPT</h2><IconButton label="关闭重生成" onClick={onClose}><X size={16} /></IconButton></header>
    <p className="mt-4 text-sm text-muted">使用已有论文分析重新组织汇报，成功后保留当前文稿作为上一版。</p>
    <label className="mt-5 block text-sm" htmlFor="regeneration-instruction">你希望怎么汇报这篇论文？</label>
    <textarea id="regeneration-instruction" aria-label="重生成要求" className={`${inputClass} mt-2 min-h-36`} value={value} onChange={event => setValue(event.target.value)} placeholder="例如：中文，15 页左右，重点讲结果和创新点" />
    {disabled && <p className="mt-3 text-xs text-muted">联网并配置模型 Key 后可开始重生成。</p>}
    <footer className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>取消</Button><Button primary disabled={disabled} onClick={() => onStart(value)}>开始重生成</Button></footer>
  </dialog>;
}
