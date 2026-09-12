import type { PromptCatalog } from '../llm/promptCatalog';
import { getAnalysisProgress, PaperAnalysisError, selectionImpact } from '../../modules/paper/analysisUnits';
import { beginActivity } from '../activity';
import type { createModelRequests } from '../llm/requests';
import type { ModelSettings } from '../settings/modelSettings';
import { AnalysisUnitError, preparePaper } from '../workflows/preparePaper';
import type { AnalysisProject, AnalysisStore, PageSelectionInput, ResourceFactory } from './ports';

export type AnalysisSnapshot = {
  data?: AnalysisProject;
  progress?: { completed: number; total?: number; ready: boolean };
  status: 'idle' | 'running' | 'paused' | 'cancelled' | 'failed' | 'completed';
  stage: string;
  documentId?: string;
  pageNumber?: number;
  error?: string;
  startedAt?: number;
  elapsedMs: number;
};
export function createAnalysisService(
  store: AnalysisStore,
  createResource: ResourceFactory,
  requests: ReturnType<typeof createModelRequests>,
  prompts: PromptCatalog,
) {
  const sessions = new Map<string, ReturnType<typeof createSession>>();
  const observers = new Set<() => void>();
  let version = 0;
  let accessOrder = 0;
  const idleSnapshotLimit = 8;
  function releaseIdleSnapshots() {
    const idle = [...sessions.values()]
      .filter((session) => session.canReleaseSnapshot())
      .sort((left, right) => left.lastAccess() - right.lastAccess());
    for (const session of idle.slice(0, Math.max(0, idle.length - idleSnapshotLimit))) session.releaseSnapshot();
  }
  function createSession(projectId: string) {
    let state: AnalysisSnapshot = { status: 'idle', stage: '', elapsedMs: 0 };
    const listeners = new Set<() => void>();
    const previewResources = new Map<string, ReturnType<ResourceFactory>>();
    let task: AbortController | undefined;
    let runPromise: Promise<void> | undefined;
    let settings: ModelSettings | undefined;
    let lastAccess = ++accessOrder;
    let pending = 0;
    let running = 0;
    let closed = false;
    const touch = () => {
      lastAccess = ++accessOrder;
    };
    const assertOpen = () => {
      if (closed) throw new PaperAnalysisError('closed-project', '项目会话已关闭，请重新打开项目。');
    };
    const releasePreviews = async () => {
      const resources = [...previewResources.values()];
      previewResources.clear();
      await Promise.all(resources.map((resource) => resource.dispose().catch(() => {})));
    };
    async function hold<T>(work: () => Promise<T>): Promise<T> {
      assertOpen();
      pending++;
      touch();
      try {
        const result = await work();
        assertOpen();
        return result;
      } finally {
        pending--;
        releaseIdleSnapshots();
      }
    }
    const update = (patch: Partial<AnalysisSnapshot>) => {
      if (closed) return;
      touch();
      if (patch.data) {
        const progress = getAnalysisProgress(patch.data.paper);
        patch = { ...patch, progress: { completed: progress.completed, total: progress.total, ready: progress.ready } };
      }
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
      version++;
      for (const observer of observers) observer();
      releaseIdleSnapshots();
    };
    function load() {
      return hold(async () => {
        const data = await store.openProject(projectId);
        assertOpen();
        update({ data });
        return data;
      });
    }
    function start(configuration: ModelSettings) {
      assertOpen();
      touch();
      if (task) return runPromise!;
      if (!configuration.apiKey.trim())
        return Promise.reject(new PaperAnalysisError('missing-key', '请先配置模型，再开始分析。'));
      const done = beginActivity();
      settings = structuredClone(configuration);
      const controller = new AbortController();
      task = controller;
      running++;
      const startedAt = Date.now();
      update({ status: 'running', stage: '准备分析', error: undefined, startedAt, elapsedMs: 0 });
      runPromise = (async () => {
        try {
          const data = await preparePaper({
            prompts,
            projectId,
            settings: configuration,
            store,
            createResource,
            requests,
            signal: controller.signal,
            onProgress: (event) => {
              if (task !== controller || controller.signal.aborted) return;
              update({ ...event, data: event.data ?? state.data, elapsedMs: Date.now() - startedAt });
            },
          });
          if (task === controller && !controller.signal.aborted)
            update({ data, status: 'completed', stage: '分析已保存', elapsedMs: Date.now() - startedAt });
        } catch (cause) {
          if (!controller.signal.aborted && task === controller)
            update({
              status: 'failed',
              ...(cause instanceof AnalysisUnitError
                ? { documentId: cause.documentId, pageNumber: cause.pageNumber }
                : {}),
              error: cause instanceof Error ? cause.message : '分析失败，已保存单元仍保留。',
              stage: '等待重试',
              elapsedMs: Date.now() - startedAt,
            });
        } finally {
          if (task === controller) task = undefined;
          running--;
          done();
          releaseIdleSnapshots();
        }
      })();
      return runPromise;
    }
    function stop(status: 'paused' | 'cancelled') {
      const cancelled = task;
      task = undefined;
      cancelled?.abort();
      update({
        status,
        stage: status === 'paused' ? '已暂停，点击继续处理未完成部分' : '已取消，已保存内容仍保留',
        elapsedMs: state.startedAt ? Date.now() - state.startedAt : state.elapsedMs,
      });
    }
    function select(input: Omit<PageSelectionInput, 'projectId'>) {
      return hold(async () => {
        const wasReady = state.data && getAnalysisProgress(state.data.paper).ready;
        const data = await store.setPageSelection({ projectId, ...input });
        assertOpen();
        update({ data, error: undefined });
        if (wasReady && state.status !== 'paused' && state.status !== 'cancelled' && !task && settings)
          void start(settings);
        return data;
      });
    }
    return {
      snapshot: () => state,
      lastAccess: () => lastAccess,
      touch,
      canReleaseSnapshot: () => !!state.data && !listeners.size && !running && !pending && !closed,
      releaseSnapshot() {
        state = { ...state, data: undefined };
        settings = undefined;
        void releasePreviews();
      },
      async dispose() {
        closed = true;
        task?.abort();
        task = undefined;
        state = { ...state, data: undefined, status: 'cancelled' };
        settings = undefined;
        listeners.clear();
        await releasePreviews();
        await runPromise;
      },
      subscribe: (listener: () => void) => {
        assertOpen();
        touch();
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) {
            void releasePreviews();
            releaseIdleSnapshots();
          }
        };
      },
      load,
      start,
      pause: () => stop('paused'),
      cancel: () => stop('cancelled'),
      select,
      configure: (configuration: ModelSettings) => {
        assertOpen();
        settings = structuredClone(configuration);
      },
      impact: (documentId: string, pageNumber: number) =>
        state.data ? selectionImpact(state.data.paper, documentId, pageNumber) : undefined,
      saveRequirements(instruction: string) {
        return hold(async () => {
          await store.saveRequirements(projectId, instruction);
          return load();
        });
      },
      openStep(step: NonNullable<AnalysisProject['project']['lastOpenedStep']>) {
        return hold(async () => {
          const latest = await load();
          if (step === 'figure-review' && !getAnalysisProgress(latest.paper).ready)
            throw new PaperAnalysisError('not-ready', '全文、图源和证据尚未全部保存，请继续分析。');
          await store.openStep(projectId, step);
          await load();
        });
      },
      preview(documentId: string, pageNumber: number, signal: AbortSignal) {
        return hold(async () => {
          const asset = state.data?.assets[documentId];
          if (!asset) throw new PaperAnalysisError('missing-pdf', '原 PDF 缺失。');
          let resource = previewResources.get(documentId);
          if (!resource) {
            resource = createResource(asset.blob);
            previewResources.set(documentId, resource);
          }
          return resource.preview(pageNumber, signal);
        });
      },
    };
  }
  return {
    version: () => version,
    subscribe: (observer: () => void) => {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
    peek: (projectId: string) => sessions.get(projectId)?.snapshot(),
    session(projectId: string) {
      let session = sessions.get(projectId);
      if (!session) {
        session = createSession(projectId);
        sessions.set(projectId, session);
      }
      session.touch();
      return session;
    },
    async remove(projectId: string) {
      const session = sessions.get(projectId);
      sessions.delete(projectId);
      await session?.dispose();
      version++;
      for (const observer of observers) observer();
      releaseIdleSnapshots();
    },
  };
}
export type AnalysisService = ReturnType<typeof createAnalysisService>;
export type AnalysisSession = ReturnType<AnalysisService['session']>;
