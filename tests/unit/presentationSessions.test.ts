import { describe, expect, it, vi } from 'vitest';
import type { FigureResources } from '../../src/app/paper/figureResources';
import { DeckSession } from '../../src/app/presentation/DeckSession';
import { createOutlineSession } from '../../src/app/presentation/OutlineSession';
import { createPresentationSessions } from '../../src/app/presentation/projectSessions';
import { createSlidesController } from '../../src/app/presentation/slidesController';
import type { SlidesWorkspace } from '../../src/app/presentation/slidesPorts';
import { createSpeechController } from '../../src/app/presentation/speechController';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { slidesFixture } from '../speech-fixture';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function harness() {
  const { state: speech, deck } = slidesFixture();
  const id = speech.project.id;
  let slides: SlidesWorkspace = { ...speech, workingPaper: speech.paper, current: deck, assets: {}, candidateKey: '' };
  let slidesGate = Promise.resolve();
  let speechGate = Promise.resolve();
  const disposed = vi.fn();
  const resources = (): FigureResources => ({
    acquire: async () => {
      throw new Error('unused');
    },
    local: async () => {
      throw new Error('unused');
    },
    dispose: disposed,
  });
  type SlideService = Parameters<typeof createSlidesController>[1]['service'];
  const generation = vi.fn<SlideService['generate']>(async (input) => {
    await slidesGate;
    input.assertActive();
    input.signal.throwIfAborted();
    return structuredClone(slides);
  });
  const speechGeneration = vi.fn<Parameters<typeof createSpeechController>[1]['generate']>(async (input) => {
    await speechGate;
    input.assertActive();
    input.signal.throwIfAborted();
  });
  const sessions = createPresentationSessions({
    slides: (projectId, guards) =>
      createSlidesController(projectId, {
        ...guards,
        service: {
          open: async () => structuredClone(slides),
          resources,
          session: (data) =>
            new DeckSession(
              data.current!,
              data.paper,
              async (_previous, next, _record, options) => {
                if (!options?.isTaskActive?.()) throw new Error('inactive');
                slides = { ...slides, current: next };
              },
              id,
            ),
          generate: generation,
          export: vi.fn(),
          candidate: vi.fn(),
          restore: vi.fn(),
          rememberSlide: vi.fn(),
        },
        ask: async ({ session }) => ({
          answer: 'fixed',
          proposal: {
            capture: session.capture(),
            args: {
              scope: { type: 'deck' },
              summary: '改标题',
              mutations: [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '候选标题' } }],
            },
            preview: structuredClone(session.current),
            slideIds: ['slide-0'],
          },
        }),
      }),
    speech: (projectId, guards) =>
      createSpeechController(projectId, {
        ...guards,
        resources: async () => resources(),
        generate: speechGeneration,
        session: () =>
          createOutlineSession(
            projectId,
            {
              open: async () => structuredClone(speech),
              save: async (input) => {
                input.assertActive();
                speech.target = { ...speech.target!, revision: speech.target!.revision + 1, content: input.content };
                return structuredClone(speech);
              },
              saveGenerated: vi.fn(),
            },
            guards.beforeEdit,
          ),
        ask: async ({ session, scope }) => ({
          answer: 'fixed',
          proposal: {
            capture: session.capture(),
            scope,
            summary: '固定提案',
            commands: [],
            preview: session.snapshot().data!.target!.content,
          },
        }),
      }),
  });
  return {
    id,
    sessions,
    generation,
    speechGeneration,
    disposed,
    holdSlides: (promise: Promise<void>) => {
      slidesGate = promise;
    },
    holdSpeech: (promise: Promise<void>) => {
      speechGate = promise;
    },
  };
}
describe('项目级讲稿与幻灯片会话', () => {
  it('切换步骤保留生成与同一会话，往返不会重复启动模型', async () => {
    const h = harness();
    const detach = h.sessions.attach(h.id);
    const slides = h.sessions.slides(h.id);
    await slides.load();
    const gate = deferred();
    h.holdSlides(gate.promise);
    const running = slides.generate(DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(h.generation).toHaveBeenCalledOnce());
    await slides.leave();
    await h.sessions.speech(h.id).load();
    expect(h.generation.mock.calls[0][0].signal.aborted).toBe(false);
    expect(h.sessions.slides(h.id)).toBe(slides);
    await slides.load();
    await slides.generate(DEFAULT_SETTINGS);
    expect(h.generation).toHaveBeenCalledOnce();
    gate.resolve();
    await running;
    expect(slides.snapshot().status).toBe('完整幻灯片已保存');
    expect(slides.snapshot().running).toBe(false);
    detach();
    await Promise.resolve();
  });
  it('讲稿任务跨视图继续，离开项目丢弃局部状态但允许已授权任务完成', async () => {
    const h = harness();
    const detach = h.sessions.attach(h.id);
    const speech = h.sessions.speech(h.id);
    await speech.load();
    const gate = deferred();
    h.holdSpeech(gate.promise);
    const running = speech.generate(DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(h.speechGeneration).toHaveBeenCalledOnce());
    await speech.leave();
    await h.sessions.slides(h.id).load();
    expect(h.speechGeneration.mock.calls[0][0].signal.aborted).toBe(false);
    detach();
    await Promise.resolve();
    expect(h.speechGeneration.mock.calls[0][0].signal.aborted).toBe(false);
    gate.resolve();
    await running;
    await Promise.resolve();
    expect(h.disposed).toHaveBeenCalledTimes(2);
  });
  it('同版本重开保留 Undo 与提案，关闭项目后丢弃', async () => {
    const h = harness();
    const detach = h.sessions.attach(h.id);
    const slides = h.sessions.slides(h.id);
    await slides.load();
    await slides.commit([{ type: 'update-slide', slideId: 'slide-0', changes: { title: '人工标题' } }], '修改');
    await slides.send(DEFAULT_SETTINGS, '改标题', 'edit');
    const slideProposal = slides.snapshot().proposal!;
    const speech = h.sessions.speech(h.id);
    await speech.load();
    await speech.session.commit([{ type: 'update-paragraph', paragraphId: 'paragraph-a', text: '人工讲稿' }]);
    await speech.send({
      settings: DEFAULT_SETTINGS,
      question: '改文字',
      mode: 'modify',
      scope: { type: 'all' },
      label: '全文',
    });
    const speechProposal = speech.snapshot().proposal!;
    await speech.leave();
    await speech.load();
    expect(speech.session.snapshot().canUndo).toBe(true);
    expect(speech.snapshot().proposal).toBe(speechProposal);
    expect(() => speech.session.assertCapture(speechProposal.capture)).not.toThrow();
    await slides.load();
    expect(slides.snapshot().session!.canUndo).toBe(true);
    expect(slides.snapshot().proposal).toBe(slideProposal);
    await slides.applyProposal();
    expect(slides.snapshot().deck!.slides[0].title).toBe('候选标题');
    await slides.send(DEFAULT_SETTINGS, '再次改标题', 'edit');
    expect(slides.snapshot().proposal).toBeDefined();
    detach();
    await Promise.resolve();
    const reattach = h.sessions.attach(h.id);
    const reopened = h.sessions.slides(h.id);
    await reopened.load();
    expect(reopened).not.toBe(slides);
    expect(reopened.snapshot().session!.canUndo).toBe(false);
    expect(reopened.snapshot().proposal).toBeUndefined();
    const reopenedSpeech = h.sessions.speech(h.id);
    await reopenedSpeech.load();
    expect(reopenedSpeech).not.toBe(speech);
    expect(reopenedSpeech.snapshot().proposal).toBeUndefined();
    expect(reopenedSpeech.session.snapshot().canUndo).toBe(false);
    reattach();
    await Promise.resolve();
  });
  it('取消后迟到生成不能接管新任务，其他步骤的人工编辑立即失效生成', async () => {
    const h = harness();
    const detach = h.sessions.attach(h.id);
    const slides = h.sessions.slides(h.id);
    await slides.load();
    const gate = deferred();
    h.holdSlides(gate.promise);
    const running = slides.generate(DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(h.generation).toHaveBeenCalledOnce());
    const speech = h.sessions.speech(h.id);
    await speech.load();
    await expect(speech.generate(DEFAULT_SETTINGS)).rejects.toMatchObject({ code: 'busy' });
    speech.change('paragraph-a', { type: 'update-paragraph', paragraphId: 'paragraph-a', text: '新输入' });
    expect(h.generation.mock.calls[0][0].signal.aborted).toBe(true);
    gate.resolve();
    await running;
    expect(slides.snapshot().running).toBe(false);
    expect(slides.snapshot().status).toBe('已取消，保存成果保留');
    await speech.discard();
    detach();
    await Promise.resolve();
  });
});
