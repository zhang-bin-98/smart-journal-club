import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisService } from '../../src/app/paper/analysisService';
import type { AnalysisProject, AnalysisStore, PaperResource } from '../../src/app/paper/ports';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { migratePaperV1, migrateProjectV1 } from '../../src/modules/paper/migration';
import { fixturePaper } from '../fixtures';
import { legacyProject } from '../legacy-fixtures';

const workflow = vi.hoisted(() => ({ preparePaper: vi.fn() }));
vi.mock('../../src/app/workflows/preparePaper', async (original) => ({
  ...(await original<object>()),
  preparePaper: workflow.preparePaper,
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup() {
  const loadData = (id: string): AnalysisProject => {
    const legacy = legacyProject({ id, paperId: `${id}-paper`, pdfAssetId: `${id}-asset`, checkpoint: 'paper-ready' });
    const paper = migratePaperV1({ ...structuredClone(fixturePaper), id: legacy.paperId }, legacy, 'fixture.pdf');
    return {
      project: migrateProjectV1(legacy),
      paper,
      assets: { [paper.documents[0].id]: { blob: new Blob(['%PDF-fixture']), name: 'fixture.pdf' } },
    };
  };
  const openProject = vi.fn(async (id: string) => loadData(id));
  const store: AnalysisStore = {
    openProject,
    commitUnit: vi.fn(),
    setPageSelection: vi.fn(),
    saveRequirements: vi.fn(),
    openStep: vi.fn(),
  };
  const disposed = vi.fn(async () => {});
  const createResource = (): PaperResource => ({
    pageCount: async () => 1,
    title: async () => undefined,
    text: vi.fn(),
    discover: vi.fn(),
    figureInput: vi.fn(),
    preview: async () => 'fixture-preview',
    dispose: disposed,
  });
  const service = createAnalysisService(store, createResource, {} as Parameters<typeof createAnalysisService>[2]);
  const fill = async (prefix: string, count = 10) => {
    for (let index = 0; index < count; index++) await service.session(`${prefix}-${index}`).load();
  };
  return { service, fill, disposed, openProject, loadData };
}

beforeEach(() => {
  workflow.preparePaper.mockReset();
});
describe('M15 分析会话的有界资源生命周期', () => {
  it('释放最旧闲置全文和预览，保留轻量状态；订阅会话和重新打开可用', async () => {
    const { service, fill, disposed, openProject } = setup();
    const first = service.session('first');
    const data = await first.load();
    first.pause();
    await first.preview(data.paper.documents[0].id, 1, new AbortController().signal);
    await fill('idle');
    expect(first.snapshot()).toMatchObject({
      data: undefined,
      status: 'paused',
      progress: { completed: 0, ready: false },
    });
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(
      Array.from({ length: 10 }, (_, index) => service.peek(`idle-${index}`)).filter((state) => state?.data),
    ).toHaveLength(8);
    const unsubscribe = first.subscribe(() => {});
    await first.load();
    await fill('more');
    expect(first.snapshot().data?.project.id).toBe('first');
    expect(first.snapshot().status).toBe('paused');
    expect(openProject.mock.calls.filter(([id]) => id === 'first')).toHaveLength(2);
    expect(workflow.preparePaper).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('不释放活动分析，取消后的迟到结果不覆盖状态；缓存重开不自动续跑', async () => {
    const { service, fill } = setup();
    const active = service.session('active');
    const data = await active.load();
    const held = deferred<AnalysisProject>();
    let late!: () => void;
    workflow.preparePaper.mockImplementation(async ({ onProgress }) => {
      late = () => onProgress({ data, stage: 'late' });
      return held.promise;
    });
    const running = active.start({ ...DEFAULT_SETTINGS, apiKey: 'fixture-key' });
    await fill('other');
    expect(active.snapshot().data?.project.id).toBe('active');
    active.cancel();
    late();
    held.resolve(data);
    await running;
    expect(active.snapshot().status).toBe('cancelled');
    await fill('after-cancel');
    expect(active.snapshot().data).toBeUndefined();
    expect(service.peek('active')?.status).toBe('cancelled');
    await active.load();
    expect(active.snapshot().status).toBe('cancelled');
    expect(workflow.preparePaper).toHaveBeenCalledTimes(1);
  });

  it('删除释放预览并拒绝在途读取，旧会话不会复活已移除项目', async () => {
    const { service, disposed, openProject, loadData } = setup();
    const previous = service.session('deleted');
    const data = await previous.load();
    await previous.preview(data.paper.documents[0].id, 1, new AbortController().signal);
    const held = deferred<AnalysisProject>();
    openProject.mockImplementationOnce(() => held.promise);
    const pending = previous.load();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'closed-project' });
    await service.remove('deleted');
    held.resolve(loadData('deleted'));
    await rejected;
    expect(service.peek('deleted')).toBeUndefined();
    expect(previous.snapshot().data).toBeUndefined();
    expect(disposed).toHaveBeenCalledTimes(1);
    const reopened = service.session('deleted');
    expect(reopened).not.toBe(previous);
    await reopened.load();
    expect(reopened.snapshot().status).toBe('idle');
    expect(workflow.preparePaper).not.toHaveBeenCalled();
  });
});
