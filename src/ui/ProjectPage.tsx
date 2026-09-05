import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Play, X } from 'lucide-react';
import { DeckSession } from '../deck';
import { PdfResource, PDF_EXPORT_EDGE } from '../pdf';
import { loadProject, saveRevision, saveStage, updateProject, type ProjectData } from '../storage';
import { Brand, Button, errorMessage, IconButton, inputClass } from './controls';
import { Editor } from './editor/Editor';
import { SourceDialog, type SourceSelection } from './SourceDialog';

type OpenProject = { data: ProjectData; resource?: PdfResource; controller: AbortController };
export function ProjectPage({ id, onLeave }: { id: string; onLeave: () => void }) {
  const [opened, setOpened] = useState<OpenProject>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let resource: PdfResource | undefined;
    setOpened(undefined); setError('');
    loadProject(id).then(data => {
      if (controller.signal.aborted) return;
      if (data.asset) resource = new PdfResource(data.asset.blob);
      setOpened({ data, resource, controller });
    }, cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => { controller.abort(); void resource?.dispose().catch(() => {}); };
  }, [id]);
  if (opened) return <ProjectContent key={id} opened={opened} onLeave={onLeave} />;
  return <main className="mx-auto max-w-[1000px] p-6"><Button onClick={onLeave}><ArrowLeft size={16} />返回首页</Button><p role={error ? 'alert' : 'status'} className="mt-8 text-sm">{error || '正在打开项目…'}</p></main>;
}

function ProjectContent({ opened, onLeave }: { opened: OpenProject; onLeave: () => void }) {
  const { resource, controller } = opened;
  const [data, setData] = useState(opened.data);
  const [instruction, setInstruction] = useState(data.project.preferences.instruction);
  const [source, setSource] = useState<SourceSelection>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parseTask = useRef<AbortController | undefined>(undefined);
  const [session] = useState(() => data.deck ? new DeckSession(data.deck, data.paper, (previous, next, record) => saveRevision(data.project.id, previous, next, record, controller.signal)) : undefined);
  const image = useMemo(() => async (element: Parameters<PdfResource['image']>[1]) => {
    if (!resource) throw new Error('原 PDF 缺失'); return resource.image(data.paper, element);
  }, [resource, data.paper]);
  useEffect(() => () => parseTask.current?.abort(), []);
  async function savePreferences() {
    if (instruction === data.project.preferences.instruction) return;
    const project = await updateProject(data.project.id, { preferences: { ...data.project.preferences, instruction } });
    if (!controller.signal.aborted) setData(value => ({ ...value, project }));
  }
  async function parse() {
    if (!resource || parseTask.current) return;
    const task = new AbortController(); parseTask.current = task; setBusy(true); setError('');
    const cancel = () => task.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      await savePreferences();
      const paper = await resource.parse(data.paper, task.signal);
      const project = await saveStage(data.project, { checkpoint: 'pdf-parsed', paper }, task.signal);
      if (!controller.signal.aborted) setData(value => ({ ...value, paper, project }));
    } catch (cause) { if (!controller.signal.aborted) setError(task.signal.aborted ? '已停止解析，原 PDF 已保存。' : errorMessage(cause)); }
    finally { controller.signal.removeEventListener('abort', cancel); parseTask.current = undefined; if (!controller.signal.aborted) setBusy(false); }
  }
  const content = session ? <Editor session={session} paper={data.paper} image={image} name={data.project.name} initialSlideId={data.project.lastOpenedSlideId} onLeave={onLeave}
    onSelection={async id => { await updateProject(data.project.id, { lastOpenedSlideId: id }); }}
    onSource={(sourceId, element, _slideId, crop, apply) => setSource({ sourceId, element, crop, apply })}
    onExport={async deck => {
      if (!resource && deck.slides.some(slide => slide.elements.some(element => element.type === 'figure'))) throw new Error('原 PDF 缺失，无法导出图源');
      const { exportDeck, downloadDeck } = await import('../export');
      const blob = await exportDeck(deck, data.paper, element => resource!.image(data.paper, element, PDF_EXPORT_EDGE), controller.signal);
      await loadProject(data.project.id); controller.signal.throwIfAborted();
      downloadDeck(blob, data.project.name);
    }} /> : <main className="mx-auto max-w-[1080px] px-5 py-6">
    <header className="flex items-center gap-3 border-b border-line pb-5"><IconButton label="返回首页" disabled={busy} onClick={() => { void savePreferences().then(onLeave, cause => setError(errorMessage(cause))); }}><ArrowLeft size={16} /></IconButton><Brand /><h1 className="min-w-0 flex-1 truncate text-sm">{data.project.name}</h1></header>
    <section className="mx-auto max-w-[760px] py-12">
      <p className="flex items-center gap-3 text-sm text-muted"><FileText size={20} />已保存：{data.asset?.name ?? '原 PDF 缺失'}</p>
      <label className="mt-10 block text-sm font-medium" htmlFor="instruction">你希望怎么汇报这篇论文？（可选）</label>
      <textarea id="instruction" className={`${inputClass} mt-3 min-h-36 resize-y`} placeholder="例如：中文，15 页左右，重点讲结果和创新点" value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)} onBlur={() => { void savePreferences().catch(cause => setError(errorMessage(cause))); }} />
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {!resource && <p role="alert" className="mt-4 text-sm text-red-700">原 PDF 缺失，请保留项目中的可读内容。</p>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {busy ? <><span role="status" className="text-sm text-muted">正在解析论文…</span><Button onClick={() => parseTask.current?.abort()}><X size={15} />取消</Button></>
          : data.project.checkpoint === 'project-created' ? <Button primary disabled={!resource} onClick={() => void parse()}><Play size={15} />{error ? '重试解析论文' : '解析论文'}</Button>
          : <><span className="text-sm text-success">已解析 {data.paper.pages.length} 页</span><Button disabled={!resource || !data.paper.sources.length} onClick={() => setSource({ sourceId: data.paper.sources[0].id, crop: false })}><FileText size={15} />查看论文</Button></>}
      </div>
    </section>
  </main>;
  return <>{content}{source && <SourceDialog paper={data.paper} resource={resource} selection={source} onClose={() => setSource(undefined)} />}</>;
}
