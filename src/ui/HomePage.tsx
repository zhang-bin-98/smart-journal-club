import { useEffect, useRef, useState } from 'react';
import { FileUp, MoreHorizontal, Pencil, Settings, Trash2 } from 'lucide-react';
import { createProject, deleteProject, listProjects, updateProject } from '../modules/project/projectRepository';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../app/activity';
import { Brand, Button, errorMessage, IconButton, inputClass } from './controls';

export function HomePage({ openProject, onSettings, registerLeaveGuard }: { openProject: (id: string) => void; onSettings: () => void; registerLeaveGuard?: RegisterLeaveGuard }) {
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<string>();
  const [rename, setRename] = useState<{ id: string; name: string }>();
  const [deleting, setDeleting] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const working = useRef(false);
  const [acting, setActing] = useState(false);
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => { if (uploading.current || working.current) throw new Error('正在保存项目，请稍后再离开'); if (rename || deleting) throw new Error('请先完成或取消当前项目操作'); };
  useEffect(() => { registerLeaveGuard?.(() => leave.current()); return () => { registerLeaveGuard?.(); setDirty('home-form', false); }; }, [registerLeaveGuard]);
  function closeForm() { setRename(undefined); setDeleting(undefined); setDirty('home-form', false); }
  useEffect(() => {
    let active = true; const done = beginActivity();
    listProjects().then(result => { if (active) setProjects(result); }, cause => { if (active) setError(errorMessage(cause)); }).finally(done);
    return () => { active = false; };
  }, [refresh]);
  async function upload(files: FileList | File[]) {
    if (uploading.current) return;
    if (files.length !== 1) { setError('每个项目只接受一份 PDF'); return; }
    uploading.current = true; const done = beginActivity(); setSaving(true); setError('');
    try {
      const { checkPdfFile } = await import('../shared/pdf/pdfResource'); await checkPdfFile(files[0]);
      const project = await createProject(files[0]);
      void navigator.storage?.persist?.().catch(() => false);
      uploading.current = false; openProject(project.id);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { done(); uploading.current = false; setSaving(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function action(work: () => Promise<unknown>) {
    if (working.current) return; working.current = true; setActing(true); const done = beginActivity();
    try { await work(); setMenu(undefined); closeForm(); setError(''); setRefresh(value => value + 1); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { working.current = false; setActing(false); done(); }
  }
  return <main className="mx-auto min-h-screen max-w-[1080px] px-5 py-6 text-ink">
    <header className="flex items-center justify-between border-b border-line pb-5"><Brand /><IconButton label="模型设置" disabled={saving || acting} onClick={onSettings}><Settings size={17} /></IconButton></header>
    <section className="py-12 sm:py-16">
      <h1 className="text-2xl font-semibold">论文项目</h1>
      <div className="mt-6 flex min-h-[220px] flex-col items-center justify-center gap-5 border-2 border-dashed border-control bg-white px-5 py-8" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files); }}>
        <FileUp size={32} className="text-accent" strokeWidth={1.5} />
        <p className="text-sm text-muted">{saving ? '正在保存论文…' : '将一篇论文 PDF 拖到这里'}</p>
        <Button primary disabled={saving || acting} onClick={() => fileInput.current?.click()}><FileUp size={16} />{error ? '重新选择 PDF' : '选择 PDF'}</Button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" aria-label="选择论文 PDF" className="hidden" onChange={event => { if (event.target.files?.length) void upload(event.target.files); }} />
      </div>
    </section>
    {error && <p role="alert" className="mb-5 text-sm text-red-700">{error}</p>}
    {!!projects.length && <section><h2 className="mb-4 text-base font-semibold">最近项目</h2>
      <div className="border-t border-line">{projects.map(({ project, slideCount }) => <div key={project.id} className="relative flex flex-wrap items-center gap-3 border-b border-line py-4">
        {rename?.id === project.id ? <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); if (rename.name.trim()) void action(() => updateProject(project.id, { name: rename.name.trim() })); }}>
          <input aria-label="项目名称" autoFocus className={inputClass} value={rename.name} onChange={event => setRename({ ...rename, name: event.target.value })} />
          <Button type="submit" disabled={!rename.name.trim() || acting}>保存</Button><Button disabled={acting} onClick={closeForm}>取消</Button>
        </form> : <button disabled={saving || acting || !!rename || !!deleting} className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => openProject(project.id)}><span className="block truncate text-sm font-medium">{project.name}</span><span className="mt-1 block text-xs text-muted">{slideCount !== undefined ? `${slideCount} 页 · 已完成` : '待继续'} · {new Date(project.updatedAt).toLocaleString('zh-CN')}</span></button>}
        <IconButton label={`${project.name} 更多操作`} disabled={saving || acting || !!rename || !!deleting} onClick={() => setMenu(menu === project.id ? undefined : project.id)}><MoreHorizontal size={16} /></IconButton>
        {menu === project.id && <div className="absolute top-14 right-0 z-10 grid gap-1 rounded border border-line bg-white p-1 shadow-sm"><Button onClick={() => { setDirty('home-form', true); setRename({ id: project.id, name: project.name }); setMenu(undefined); }}><Pencil size={14} />重命名</Button><Button onClick={() => { setDirty('home-form', true); setDeleting(project.id); setMenu(undefined); }}><Trash2 size={14} />删除项目</Button></div>}
        {deleting === project.id && <div role="alert" className="flex w-full flex-wrap items-center gap-3 text-sm text-red-700"><span>删除此项目及原 PDF？此操作无法撤销。</span><Button disabled={acting} onClick={() => void action(() => deleteProject(project.id))}>确认删除</Button><Button disabled={acting} onClick={closeForm}>取消</Button></div>}
      </div>)}</div>
    </section>}
  </main>;
}
