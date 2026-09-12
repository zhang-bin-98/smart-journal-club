import { planSlides } from '../../src/app/workflows/planSlides';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { prompts } from '../../src/infrastructure/llm/prompts';
import type { createModelRequests } from '../../src/app/llm/requests';
import { fixtureDeck, fixturePaper } from '../fixtures';
import { describe, it, expect, vi } from 'vitest';
import { paginateSpeech, assertPlanningContent } from '../../src/modules/presentation/planning/paginateSpeech';
import { exportPresentation } from '../../src/app/presentation/exportPresentation';
import type { SlidesWorkspace } from '../../src/app/presentation/slidesPorts';
import { slidesFixture as fixture } from '../speech-fixture';
import { buildPresentation, assertBuiltPlan } from '../../src/modules/presentation/build';
import { groupPreset, groupRects, groupLeaves, rankGroups } from '../../src/modules/presentation/layout';
import { computeLayout } from '../../src/modules/presentation/layout/computeLayout';
import { DeckSession } from '../../src/app/presentation/DeckSession';
import { splitSlide, mergeSlides, assignSpeech, moveSlideBy } from '../../src/modules/presentation/editing';
import { checkPresentation } from '../../src/app/presentation/checkPresentation';
import { validateDeck } from '../../src/modules/presentation/editing/validateDeck';
import { createSlidesAssistant } from '../../src/app/assistant/slidesAssistant';
describe('M18 构建、图组与讲述提交', () => {
  it('页面规划每批及修复沿用已保存讲稿语言，不被章节或配置语言覆盖', async () => {
    const { state, plan } = fixture();
    plan.language = 'en';
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ slides: [] })
      .mockImplementation(async ({ data }) => ({
        slides: [
          {
            title: 'Observed result',
            purpose: 'Explain the result',
            message: 'The evidence supports this observation.',
            kind: 'result',
            speechIndexes: data.speech.map((_: unknown, index: number) => index),
            sourceIndexes: [],
          },
        ],
      }));
    const result = await planSlides({
      record: {
        recordVersion: 2,
        projectId: state.project.id,
        stage: 'outline-ready',
        mode: 'initial',
        base: state.base,
        generationPreferences: { instruction: '', language: 'zh' },
        plan: { ...plan, status: 'draft', slides: [] },
      },
      paper: state.paper,
      settings: DEFAULT_SETTINGS,
      prompts,
      requests: { requestJson } as unknown as ReturnType<typeof createModelRequests>,
      signal: new AbortController().signal,
      assertActive() {},
    });
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson.mock.calls.every(([request]) => request.data.language === 'en')).toBe(true);
    expect(result.plan.language).toBe('en');
    expect(result.plan.speech).toEqual(plan.speech);
  });
  it('自动分页保留每个字符和段落身份，拒绝讲稿改写', () => {
    const { plan } = fixture();
    plan.speech[0].text = '完整句子含标点，保留科学限定。\n'.repeat(30);
    const divided = paginateSpeech(plan);
    expect(divided.speech.length).toBeGreaterThan(plan.speech.length);
    expect(() => assertPlanningContent(plan, divided)).not.toThrow();
    expect(divided.speechParagraphs[0].id).toBe(plan.speechParagraphs[0].id);
    divided.speech[0].text += '无证据内容';
    expect(() => assertPlanningContent(plan, divided)).toThrow('原文');
  });
  it('导出允许普通提示，拒绝硬错误与迟到下载', async () => {
    const { deck, state } = fixture();
    const data = {
      ...state,
      current: deck,
      assets: Object.fromEntries(state.paper.documents.map((d) => [d.id, { blob: new Blob(), name: d.fileName }])),
    } as unknown as SlidesWorkspace;
    const controller = new AbortController();
    const download = vi.fn(),
      render = vi.fn(async () => {
        controller.abort();
        return new Blob();
      });
    const input = {
      store: { open: async () => data },
      projectId: state.project.id,
      deck,
      signal: controller.signal,
      export: render,
      download,
    };
    await expect(exportPresentation(input)).rejects.toThrow();
    expect(render).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    deck.slides[0].title = '溢出'.repeat(500);
    await expect(exportPresentation({ ...input, signal: new AbortController().signal })).rejects.toThrow();
    expect(render).toHaveBeenCalledOnce();
    deck.slides[0].title = '恢复';
    await exportPresentation({ ...input, signal: new AbortController().signal, export: async () => new Blob() });
    expect(download).toHaveBeenCalledOnce();
  });
  it('构建沿用身份、页序、唯一正文与图组，拒绝被改变的合同', () => {
    const { state, plan, deck } = fixture();
    expect(deck.slides.map((s) => s.id)).toEqual(plan.slides.map((s) => s.id));
    expect(deck.speech).toEqual(plan.speech);
    expect(deck.slides[0].figureGroup).toEqual(plan.slides[0].figureGroup);
    expect(() => assertBuiltPlan(deck, plan, state.paper)).not.toThrow();
    deck.slides.reverse();
    expect(() => assertBuiltPlan(deck, plan, state.paper)).toThrow('沿用');
    plan.slides[0].speechIds = [];
    expect(() => buildPresentation(plan, state.paper, 'another', 1)).toThrow('遗漏');
  });
  it('不等分、间距和跨页实例几何独立，旧稿无分区不重排', () => {
    const group = groupPreset(['a', 'b', 'c'], 'left-pair', 0.35, 18);
    const rects = groupRects(group, { x: 0.06, y: 0.3, width: 0.88, height: 0.57 });
    expect(rects.a.x).toBe(rects.b.x);
    expect(rects.c.height).toBeCloseTo(0.57);
    expect(rects.a.width).toBeLessThan(rects.c.width);
    const ranked = rankGroups(
      [
        { id: 'a', aspect: 3 },
        { id: 'b', aspect: 2 },
        { id: 'c', aspect: 0.4 },
      ],
      { x: 0, y: 0, width: 0.88, height: 0.57 },
    );
    expect(ranked.length).toBeLessThanOrEqual(15);
    expect(groupLeaves(ranked[0].group.root)).toEqual(['a', 'b', 'c']);
    expect(() => groupRects({ ...group, gapPt: 500 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow();
    const { deck } = fixture();
    const old = structuredClone(deck.slides[0]);
    delete old.figureGroup;
    expect(computeLayout(old).elements[0].rect.width).toBe(0.8);
    expect(deck.slides[1].figureGroup?.root).toEqual({ kind: 'image', imageId: 'image-1' });
  });
  it('按句拆页、跨章合页与删页保留段落身份，一次撤销恢复分配', async () => {
    const { deck, state } = fixture();
    const session = new DeckSession(deck, state.paper);
    const original = structuredClone(deck.speechParagraphs);
    const segment = deck.speech![0];
    await session.commit(
      { type: 'deck' },
      splitSlide(deck, 'slide-0', segment.id, segment.text.indexOf('。') + 1),
      '拆页',
    );
    expect(session.current.speechParagraphs![0].id).toBe(original![0].id);
    expect(session.current.slides).toHaveLength(3);
    await session.undo();
    expect(session.current.speechParagraphs).toEqual(original);
    await session.commit({ type: 'deck' }, mergeSlides(session.current, 'slide-0', 'slide-1'), '合页');
    expect(session.current.speechParagraphs).toEqual(original);
    expect(session.current.slides[0].speechIds).toHaveLength(2);
    await session.commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: 'slide-0' }], '删页');
    expect(session.current.speech).toEqual(deck.speech);
    expect(session.current.slides).toHaveLength(0);
    await session.undo();
    expect(session.current.slides).toHaveLength(1);
  });
  it('保存与撤销失败均不推进状态，保存中输入使旧提案失效', async () => {
    const { deck, state } = fixture();
    let fail = false;
    const session = new DeckSession(deck, state.paper, async () => {
      if (fail) throw new Error('write failed');
    });
    fail = true;
    await expect(
      session.commit(
        { type: 'deck' },
        [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '修改' } }],
        '修改',
      ),
    ).rejects.toThrow();
    expect(session.canUndo).toBe(false);
    expect(session.current.revision).toBe(0);
    fail = false;
    await session.commit(
      { type: 'deck' },
      [{ type: 'update-slide', slideId: 'slide-0', changes: { title: '修改' } }],
      '修改',
    );
    fail = true;
    await expect(session.undo()).rejects.toThrow();
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
    expect(session.current.revision).toBe(1);
    const capture = session.capture();
    const version = session.registerDraft();
    session.registerDraft();
    session.releaseDraft(version);
    expect(() => session.assertCapture(capture)).toThrow();
    expect(session.dirty).toBe(true);
  });
  it('重复分配和非法图组拒绝保存，未分配讲稿/省略只提醒，溢出拦截', async () => {
    const { deck, state } = fixture();
    const session = new DeckSession(deck, state.paper);
    await expect(
      session.commit(
        { type: 'deck' },
        [{ type: 'update-slide', slideId: 'slide-1', changes: { speechIds: deck.slides[0].speechIds } }],
        '重复',
      ),
    ).rejects.toThrow();
    await session.commit({ type: 'deck' }, assignSpeech(deck, deck.slides[1].speechIds!, 'slide-0'), '移动');
    expect(session.current.slides[1].speechIds).toEqual([]);
    await session.commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: 'slide-0' }], '删除');
    expect(checkPresentation(session.current, state.paper, true).errors).toHaveLength(0);
    expect(
      checkPresentation(session.current, state.paper, true).warnings.some((i) => i.code === 'unassigned-speech'),
    ).toBe(true);
    session.current.slides[0].title = '过长文字'.repeat(400);
    expect(checkPresentation(session.current, state.paper, true).errors.some((i) => i.code === 'text-overflow')).toBe(
      true,
    );
    session.current.slides[0].figureGroup = groupPreset(['foreign'], 'row');
    expect(validateDeck(session.current, state.paper).join()).toContain('图组');
  });
  it('AI 只读无提案工具，局部页面不能借讲稿修改越权', async () => {
    const { deck, state } = fixture();
    const session = new DeckSession(deck, state.paper);
    const run = vi.fn(async (input: Parameters<Parameters<typeof createSlidesAssistant>[0]>[0]) => {
      expect(input.tools).toEqual([]);
      return '回答';
    });
    const ask = createSlidesAssistant(run);
    const settings = {
      protocol: 'responses' as const,
      baseUrl: 'https://example.com',
      modelId: 'test',
      apiKey: 'test',
      reasoningEffort: null,
    };
    await ask({
      session,
      paper: state.paper,
      settings,
      question: '解释',
      mode: 'ask',
      slideIds: ['slide-0'],
      signal: new AbortController().signal,
      onText() {},
    });
    const attack = createSlidesAssistant(async (input) => {
      input.tools[0].execute({
        scope: { type: 'slides', slideIds: ['slide-0'] },
        summary: '越权',
        mutations: [{ type: 'edit-speech', segmentId: deck.speech![1].id, text: 'changed' }],
      });
      return '';
    });
    await expect(
      attack({
        session,
        paper: state.paper,
        settings,
        question: '改一页',
        mode: 'edit',
        slideIds: ['slide-0'],
        signal: new AbortController().signal,
        onText() {},
      }),
    ).rejects.toThrow('授权');
  });
});

describe('旧稿与讲述稿的页面移动', () => {
  it('旧稿跨章节上下移动可保存和撤销，新稿只改页序而不改讲述归属', async () => {
    const old = new DeckSession(fixtureDeck, fixturePaper);
    await old.commit({ type: 'deck' }, moveSlideBy(old.current, 'slide-1', 1), '下移');
    expect(old.current.slides.map((s) => s.id)).toEqual(['slide-2', 'slide-1', 'slide-3']);
    expect(old.current.slides[1].sectionId).toBe(fixtureDeck.slides[1].sectionId);
    await old.commit({ type: 'deck' }, moveSlideBy(old.current, 'slide-1', -1), '上移');
    expect(old.current.slides[0].id).toBe('slide-1');
    await old.undo();
    await old.undo();
    expect(old.current.slides).toEqual(fixtureDeck.slides);
    const { state, deck } = fixture();
    const current = new DeckSession(deck, state.paper);
    const first = deck.slides[0];
    await current.commit({ type: 'deck' }, moveSlideBy(deck, first.id, 1), '下移');
    expect(current.current.slides[1].sectionId).toBe(first.sectionId);
    expect(current.current.speechParagraphs).toEqual(deck.speechParagraphs);
    expect(current.current.speech).toEqual(deck.speech);
  });
});
