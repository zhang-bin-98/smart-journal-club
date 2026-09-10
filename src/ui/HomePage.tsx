import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FolderOpen, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react';
import {
  deleteManagedProject,
  getProjectStorageOverview,
  listManagedProjects,
  renameManagedProject,
  subscribeManagedProjects,
  managedProjectsVersion,
  managedProjectStatus,
} from '../app/projects/projectService';
import { beginActivity, setDirty, type LeaveGuard, type RegisterLeaveGuard } from '../app/activity';
import { Brand, Button, errorMessage, IconButton, inputClass } from './controls';
import { CreateProjectDialog } from './projects/CreateProjectDialog';
import { ProjectDialog } from './projects/ProjectDialog';
import { StorageOverview } from './projects/StorageOverview';

const stages = [
  { id: 'analysis', label: '分析' },
  { id: 'sources', label: '图源' },
  { id: 'script', label: '讲稿' },
  { id: 'slides', label: '幻灯片' },
] as const;
type StageFilter = 'all' | (typeof stages)[number]['id'];
const listPosition = { query: '', stage: 'all' as StageFilter, scrollTop: 0 };

export function HomePage({
  openProject,
  onStartAnalysis,
  onSettings,
  modelReady = false,
  registerLeaveGuard,
}: {
  openProject: (id: string) => void;
  onStartAnalysis?: (id: string) => void;
  onSettings: () => void;
  modelReady?: boolean;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  useSyncExternalStore(subscribeManagedProjects, managedProjectsVersion);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listManagedProjects>>>([]);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof getProjectStorageOverview>>>();
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageFailed, setStorageFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [query, setQuery] = useState(listPosition.query);
  const [stage, setStage] = useState<StageFilter>(listPosition.stage);
  const [creating, setCreating] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string }>();
  const [deleting, setDeleting] = useState<{ id: string; name: string }>();
  const [acting, setActing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [storageRefresh, setStorageRefresh] = useState(0);
  const working = useRef(false);
  const creationBusy = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const leave = useRef<LeaveGuard>(async () => {});
  leave.current = async () => {
    if (creationBusy.current || working.current) throw new Error('正在保存或读取项目，请稍后再离开。');
    if (rename || deleting) throw new Error('请先完成或取消当前项目操作。');
  };
  useEffect(() => {
    registerLeaveGuard?.(() => leave.current());
    return () => {
      registerLeaveGuard?.();
      setDirty('home-form', false);
    };
  }, [registerLeaveGuard]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 完成项目写入后重新读取列表。
  useEffect(() => {
    let active = true;
    const done = beginActivity();
    setLoading(true);
    listManagedProjects()
      .then(
        (result) => {
          if (!active) return;
          setProjects(result);
          setError('');
          requestAnimationFrame(() => {
            if (list.current) list.current.scrollTop = listPosition.scrollTop;
          });
        },
        (cause) => {
          if (active) setError(errorMessage(cause));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
        done();
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 创建、删除和显式刷新触发全量统计。
  useEffect(() => {
    let active = true;
    setStorageLoading(true);
    setStorageFailed(false);
    getProjectStorageOverview()
      .then(
        (value) => {
          if (active) setStorage(value);
        },
        () => {
          if (active) {
            setStorage(undefined);
            setStorageFailed(true);
          }
        },
      )
      .finally(() => {
        if (active) setStorageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [storageRefresh]);

  function closeAction() {
    setRename(undefined);
    setDeleting(undefined);
    setActionError('');
    setDirty('home-form', false);
  }
  async function action(work: () => Promise<unknown>, changesStorage = false) {
    if (working.current) return;
    working.current = true;
    setActing(true);
    setActionError('');
    const done = beginActivity();
    try {
      await work();
      closeAction();
      setRefresh((value) => value + 1);
      if (changesStorage) setStorageRefresh((value) => value + 1);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      working.current = false;
      setActing(false);
      done();
    }
  }
  const search = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter(
    (project) =>
      (stage === 'all' || project.stage === stage) &&
      (!search || `${project.name} ${project.paperTitle ?? ''}`.toLocaleLowerCase().includes(search)),
  );
  return (
    <div className="flex h-dvh min-w-[960px] flex-col bg-canvas text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-white px-8 py-5">
        <div className="flex items-center gap-5">
          <Brand />
          <span className="text-line">│</span>
          <h1 className="text-sm font-medium">项目管理</h1>
        </div>
        <Button aria-label="模型设置" disabled={acting || !!rename || !!deleting} onClick={onSettings}>
          <Settings size={16} />
          模型设置 · {modelReady ? '已配置' : '未配置'}
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col px-8 pt-7">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-5">
          <div>
            <h2 className="text-xl font-medium">
              我的项目 <span className="ml-2 text-sm text-muted">{loading ? '' : projects.length}</span>
            </h2>
            <p className="mt-2 text-xs text-muted">从上次停下的地方继续；打开项目不会重新分析。</p>
          </div>
          <Button primary disabled={acting} onClick={() => setCreating(true)}>
            <Plus size={17} />
            新建项目
          </Button>
        </div>
        <div className="mb-5 flex shrink-0 items-center gap-3">
          <label className="relative w-80">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" />
            <input
              aria-label="搜索项目"
              className={`${inputClass} pl-9`}
              value={query}
              placeholder="搜索项目名或论文标题"
              onChange={(event) => {
                listPosition.query = event.target.value;
                listPosition.scrollTop = 0;
                setQuery(event.target.value);
              }}
            />
          </label>
          <select
            aria-label="筛选项目阶段"
            className={`${inputClass} max-w-40 shrink-0`}
            value={stage}
            onChange={(event) => {
              const next = event.target.value as StageFilter;
              listPosition.stage = next;
              listPosition.scrollTop = 0;
              setStage(next);
            }}
          >
            <option value="all">全部阶段</option>
            {stages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label === '分析' ? '论文分析' : item.label === '讲稿' ? '大纲与讲稿' : item.label}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted">按最近修改排序</span>
        </div>
        <StorageOverview
          value={storage}
          loading={storageLoading}
          failed={storageFailed}
          onRefresh={() => setStorageRefresh((value) => value + 1)}
        />
        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm text-red-700">
            <span>{error}</span>
            <Button onClick={() => setRefresh((value) => value + 1)}>重试读取</Button>
          </div>
        )}
        <div
          ref={list}
          onScroll={(event) => {
            listPosition.scrollTop = event.currentTarget.scrollTop;
          }}
          className="min-h-0 flex-1 overflow-auto rounded border border-line bg-white"
        >
          <table className="w-full table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 bg-panel text-xs text-muted">
              <tr>
                <th className="w-[30%] px-5 py-3 font-normal">项目 / 论文</th>
                <th className="w-[15%] px-3 py-3 font-normal">论文文件</th>
                <th className="w-[24%] px-3 py-3 font-normal">当前阶段</th>
                <th className="w-[13%] px-3 py-3 font-normal">最近修改</th>
                <th className="w-[18%] px-5 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((project) => {
                const current = stages.findIndex((item) => item.id === project.stage);
                return (
                  <tr key={project.id} className="border-t border-line">
                    <td className="px-5 py-5">
                      <button
                        className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-focus"
                        onClick={() => openProject(project.id)}
                      >
                        <span title={project.name} className="block truncate font-medium">
                          {project.name}
                        </span>
                        <span title={project.paperTitle} className="mt-2 block truncate text-xs text-muted">
                          {project.paperTitle || '论文原标题待分析'}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-5 text-xs text-muted">
                      <p>主论文 {project.primaryFileCount} 份</p>
                      <p className="mt-2">补充材料 {project.supplementFileCount} 份</p>
                    </td>
                    <td className="px-3 py-5">
                      <div
                        aria-label={`当前阶段：${stages[current]?.label ?? '分析'}`}
                        className="grid grid-cols-4 gap-1"
                      >
                        {stages.map((item, index) => (
                          <div key={item.id}>
                            <div
                              className={`h-1.5 rounded-sm ${index < current ? 'bg-accent' : index === current ? 'border border-accent bg-white' : 'bg-line'}`}
                            />
                            <span
                              className={`mt-1 block text-[10px] ${index === current ? 'font-medium text-accent' : 'text-muted'}`}
                            >
                              {item.label}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {managedProjectStatus(project.id, project.analysisStatus)}
                        {project.slideCount !== undefined ? ` · ${project.slideCount} 页幻灯片` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-5 text-xs text-muted">
                      <time
                        dateTime={new Date(project.updatedAt).toISOString()}
                        title={new Date(project.updatedAt).toLocaleString('zh-CN')}
                      >
                        {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
                      </time>
                    </td>
                    <td className="px-5 py-5">
                      <div className="flex items-center gap-2">
                        <Button onClick={() => openProject(project.id)}>打开</Button>
                        <IconButton
                          label={`重命名 ${project.name}`}
                          onClick={() => {
                            setRename({ id: project.id, name: project.name });
                            setDirty('home-form', true);
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          label={`删除 ${project.name}`}
                          onClick={() => {
                            setDeleting({ id: project.id, name: project.name });
                            setDirty('home-form', true);
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && !projects.length ? (
            <p role="status" className="p-12 text-center text-sm text-muted">
              正在读取项目…
            </p>
          ) : !error && !projects.length ? (
            <div className="px-6 py-16 text-center">
              <FolderOpen size={32} className="mx-auto mb-4 text-muted" />
              <h3 className="text-lg font-medium">还没有项目</h3>
              <p className="mt-3 text-sm text-muted">新建项目，上传主论文和可选的补充材料。</p>
              <Button primary className="mt-6" onClick={() => setCreating(true)}>
                新建第一个项目
              </Button>
            </div>
          ) : !error && !visibleProjects.length ? (
            <p className="p-12 text-center text-sm text-muted">没有找到匹配的项目，请修改搜索或筛选条件。</p>
          ) : null}
        </div>
        <p className="py-4 text-xs text-muted">项目和 PDF 保存在当前浏览器，跨浏览器不会自动同步。</p>
      </main>
      {creating && (
        <CreateProjectDialog
          modelReady={modelReady}
          onSettings={onSettings}
          onClose={() => setCreating(false)}
          onBusyChange={(value) => {
            creationBusy.current = value;
          }}
          onCreated={(id, start) => {
            setCreating(false);
            setRefresh((value) => value + 1);
            setStorageRefresh((value) => value + 1);
            if (start) (onStartAnalysis ?? openProject)(id);
          }}
        />
      )}
      {rename && (
        <ProjectDialog title="重命名项目" busy={acting} onClose={closeAction}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (rename.name.trim()) void action(() => renameManagedProject(rename.id, rename.name.trim()));
            }}
          >
            <label className="block text-sm">
              项目名称
              <input
                aria-label="新的项目名称"
                className={`${inputClass} mt-2`}
                value={rename.name}
                disabled={acting}
                onChange={(event) => setRename({ ...rename, name: event.target.value })}
              />
            </label>
            {actionError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {actionError} 原记录已保留，请重试。
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button disabled={acting} onClick={closeAction}>
                取消
              </Button>
              <Button primary type="submit" disabled={acting || !rename.name.trim()}>
                {acting ? '正在保存…' : '保存名称'}
              </Button>
            </div>
          </form>
        </ProjectDialog>
      )}
      {deleting && (
        <ProjectDialog title="删除项目" busy={acting} onClose={closeAction}>
          <p className="break-words text-sm leading-relaxed">
            确认删除“{deleting.name}”？这将删除项目、全部 PDF、工作底稿及编辑成果，无法撤销。模型设置会保留。
          </p>
          {actionError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {actionError} 项目记录已保留，请重试。
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <Button disabled={acting} onClick={closeAction}>
              取消
            </Button>
            <Button
              primary
              disabled={acting}
              onClick={() => void action(() => deleteManagedProject(deleting.id), true)}
            >
              {acting ? '正在删除…' : '确认删除'}
            </Button>
          </div>
        </ProjectDialog>
      )}
    </div>
  );
}
