import { describe, expect, it, vi } from 'vitest';
import {
  applySpeechProposal,
  createSpeechAssistant,
  validateSpeechScope,
} from '../../src/app/assistant/speechAssistant';
import type { createModelRequests } from '../../src/app/llm/requests';
import { createOutlineSession } from '../../src/app/presentation/OutlineSession';
import { assertGenerationBase } from '../../src/app/presentation/planRecord';
import type { SpeechSave, SpeechStore } from '../../src/app/presentation/ports';
import { speechBatches } from '../../src/app/presentation/speechBatches';
import { speechContext } from '../../src/app/presentation/speechContext';
import { DEFAULT_SETTINGS } from '../../src/app/settings/modelSettings';
import { organizeSpeech } from '../../src/app/workflows/organizeSpeech';
import { normalizeGeneratedSpeech, prepareOutline } from '../../src/app/workflows/prepareOutline';
import { prompts } from '../../src/infrastructure/llm/prompts';
import {
  applyContentCommands,
  paragraphSources,
  paragraphText,
  uncoveredClaims,
} from '../../src/modules/presentation/content';
import { speechFixture } from '../speech-fixture';

function harness() {
  const data = speechFixture();
  let fail = false;
  let beforeSave: (() => Promise<void>) | undefined;
  const store: SpeechStore = {
    async open() {
      return structuredClone(data);
    },
    async save(input: SpeechSave) {
      if (beforeSave) await beforeSave();
      input.assertActive();
      if (fail) throw new Error('storage failed');
      if (input.target.revision !== data.target!.revision) throw new Error('stale');
      data.target = { ...data.target!, revision: data.target!.revision + 1, content: input.content };
      return structuredClone(data);
    },
    async saveGenerated(input) {
      input.assertActive();
      input.signal.throwIfAborted();
      data.record = input.record;
      data.target = { kind: 'plan', id: input.record.plan.id, revision: 0, content: input.record.plan };
      data.project.checkpoint = 'outline-ready';
      return structuredClone(data);
    },
  };
  return {
    store,
    session: createOutlineSession(data.project.id, store),
    data: () => data,
    fail: (v: boolean) => {
      fail = v;
    },
    beforeSave: (v?: () => Promise<void>) => {
      beforeSave = v;
    },
  };
}
describe('M17 稳定讲述与证据', () => {
  it('生成时修复双向登记但不改正文、引用、已有顺序或歧义归属', () => {
    const original = speechFixture().target!.content;
    const content = structuredClone(original);
    const first = content.speechParagraphs[0];
    first.segmentIds = ['unknown-source-id', ...first.segmentIds, ...content.speechParagraphs[1].segmentIds];
    content.speechParagraphs[1].segmentIds = [first.segmentIds[1]];
    const corrected = normalizeGeneratedSpeech(content) as typeof content;
    expect(corrected.speech).toEqual(original.speech);
    expect(corrected.speechParagraphs).toEqual(original.speechParagraphs);
    expect(content.speechParagraphs).not.toEqual(original.speechParagraphs);
    content.speech[0].paragraphId = 'missing-paragraph';
    expect(normalizeGeneratedSpeech(content)).toBe(content);
    const duplicate = structuredClone(original);
    duplicate.speech.push(duplicate.speech[0]);
    expect(normalizeGeneratedSpeech(duplicate)).toBe(duplicate);
  });
  it('短输入中的密集发现也拆批，保留全部发现及其证据而不按讲稿预算省略', () => {
    const { paper } = speechFixture();
    const original = paper.claims[0];
    paper.claims = Array.from({ length: 33 }, (_, index) => ({ ...original, id: 'dense-' + index }));
    const groups = speechBatches(paper);
    expect(groups.every((group) => group.claims.length <= 16)).toBe(true);
    expect(groups.flatMap((group) => group.claims)).toEqual(paper.claims);
    for (const group of groups)
      for (const claim of group.claims) {
        expect(claim.evidenceIds.every((id) => group.evidences.some((evidence) => evidence.id === id))).toBe(true);
      }
  });
  it('重排章节和段落保留正文身份，多图引用可跨章节复用，删除只形成用户省略', () => {
    const { target, paper } = speechFixture();
    const content = target!.content;
    let next = applyContentCommands(
      content,
      [
        { type: 'move-section', sectionId: 'chapter-b', afterId: null },
        { type: 'move-paragraph', paragraphId: 'paragraph-a', sectionId: 'chapter-b', afterId: 'paragraph-b' },
      ],
      paper,
    );
    expect(next.speech).toEqual(content.speech);
    expect(paragraphSources(next, 'paragraph-a')).toEqual(paragraphSources(content, 'paragraph-a'));
    next = applyContentCommands(next, [{ type: 'delete-paragraph', paragraphId: 'paragraph-a' }], paper);
    expect(next.omissions.map((o) => o.claimId)).toEqual(paper.claims.map((c) => c.id));
    expect(paper.claims.length).toBeGreaterThan(0);
    expect(uncoveredClaims(content, paper)).toEqual([]);
  });
  it('拆合保存原正文、来源并集，非法引用/身份或悬空关系拒绝整批', () => {
    const { target, paper } = speechFixture();
    const content = target!.content;
    const original = paragraphText(content, 'paragraph-a');
    const split = applyContentCommands(
      content,
      [
        {
          type: 'split-paragraph',
          paragraphId: 'paragraph-a',
          offset: original.indexOf('。') + 1,
          newParagraphId: 'split',
          newSegmentId: 'split-segment',
        },
      ],
      paper,
    );
    expect(paragraphSources(split, 'split')).toEqual(paragraphSources(content, 'paragraph-a'));
    const merged = applyContentCommands(
      split,
      [{ type: 'merge-paragraph', paragraphId: 'paragraph-a', nextParagraphId: 'split' }],
      paper,
    );
    expect(paragraphText(merged, 'paragraph-a').replaceAll('\n', '')).toBe(original);
    expect(() =>
      applyContentCommands(
        content,
        [{ type: 'update-paragraph', paragraphId: 'paragraph-a', sourceIds: ['foreign'] }],
        paper,
      ),
    ).toThrow();
    expect(content.speechParagraphs).toHaveLength(2);
  });
  it('独立生成偏好不同不使基准失效，项目偏好被另改仍拒绝', () => {
    const data = speechFixture();
    expect(() => assertGenerationBase(data.base, data.project, data.paper)).not.toThrow();
    data.project.preferences.strategyId = 'different';
    expect(() => assertGenerationBase(data.base, data.project, data.paper)).toThrow('偏好');
  });
});
describe('M17 应用唯一保存入口', () => {
  it('保存/撤销失败不推进版本或历史，保存中继续输入不解除新草稿保护', async () => {
    const h = harness();
    await h.session.load();
    let edit = h.session.register('content');
    h.fail(true);
    await expect(
      h.session.commit([{ type: 'update-paragraph', paragraphId: 'paragraph-a', text: '第一稿' }], edit.id),
    ).rejects.toThrow();
    expect(h.session.snapshot()).toMatchObject({ dirty: true, canUndo: false, data: { target: { revision: 0 } } });
    h.fail(false);
    let release!: () => void;
    h.beforeSave(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = h.session.commit(
      [{ type: 'update-paragraph', paragraphId: 'paragraph-a', text: '第一稿' }],
      edit.id,
    );
    edit = h.session.register('content');
    release();
    await pending;
    expect(h.session.snapshot().dirty).toBe(true);
    h.beforeSave();
    await h.session.commit([{ type: 'update-paragraph', paragraphId: 'paragraph-a', text: '第二稿' }], edit.id);
    expect(h.session.snapshot().dirty).toBe(false);
    h.fail(true);
    await expect(h.session.undo()).rejects.toThrow();
    expect(h.session.snapshot()).toMatchObject({ canUndo: true, canRedo: false, data: { target: { revision: 2 } } });
    h.fail(false);
    await h.session.undo();
    expect(paragraphText(h.session.snapshot().data!.target!.content, 'paragraph-a')).toBe('第一稿');
    h.session.close();
  });
  it('无 Deck 的提案可预览/应用/一次撤销，人工草稿或发送对象切换拒绝旧提案', async () => {
    const h = harness();
    await h.session.load();
    const run = createSpeechAssistant(async ({ tools }) => {
      tools
        .find((t) => t.name === 'plan_propose_revision')!
        .execute({
          summary: '改写结果',
          commands: [{ type: 'update-paragraph', paragraphId: 'paragraph-a', text: '仅改写这一段。' }],
        });
      return '请查看差异。';
    });
    const args = {
      prompts,
      session: h.session,
      scope: { type: 'paragraph' as const, id: 'paragraph-a' },
      mode: 'modify' as const,
      question: '改写',
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onText: () => {},
    };
    const result = await run(args);
    expect(paragraphText(h.data().target!.content, 'paragraph-a')).not.toBe('仅改写这一段。');
    await applySpeechProposal(h.session, result.proposal!);
    expect(h.session.snapshot().canUndo).toBe(true);
    await h.session.undo();
    await expect(applySpeechProposal(h.session, result.proposal!)).rejects.toThrow();
    const later = await run(args);
    h.session.register('content');
    await expect(applySpeechProposal(h.session, later.proposal!)).rejects.toThrow();
    h.session.close();
  });
  it('段落/章节授权不能扩大，读模式不给 proposal 工具，Agent 后续失败不返回提案', async () => {
    const h = harness();
    await h.session.load();
    expect(() =>
      validateSpeechScope(h.data().target!.content, [{ type: 'delete-section', sectionId: 'chapter-b' }], {
        type: 'paragraph',
        id: 'paragraph-a',
      }),
    ).toThrow();
    const run = createSpeechAssistant(async ({ tools }) => {
      expect(tools.some((t) => t.name.includes('propose'))).toBe(false);
      return '只读';
    });
    await run({
      session: h.session,
      scope: { type: 'all' },
      mode: 'ask',
      question: '解释',
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onText: () => {},
    });
    h.session.close();
  });
});
describe('M17 生成仅到完整讲稿', () => {
  it('无 React/真实模型运行；有限一次修复，完整保存后停止且不创建 Deck', async () => {
    const h = harness();
    const raw = structuredClone(h.data().target!.content);
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ ...raw, speech: [] })
      .mockResolvedValueOnce(raw);
    await prepareOutline({
      prompts,
      projectId: h.data().project.id,
      store: h.store,
      requests: { requestJson } as unknown as ReturnType<typeof createModelRequests>,
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      assertActive() {},
    });
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(h.data().project.checkpoint).toBe('outline-ready');
    expect(h.data().project.currentDeckId).toBeUndefined();
    expect(h.data().record!.plan.slides).toEqual([]);
    expect(h.data().record!.plan.status).toBe('draft');
  });
  it('两次无效结果与取消均保护原计划', async () => {
    const h = harness();
    const original = structuredClone(h.data());
    const requestJson = vi.fn().mockResolvedValue({ ...h.data().target!.content, speech: [] });
    const args = {
      prompts,
      projectId: h.data().project.id,
      store: h.store,
      requests: { requestJson } as unknown as ReturnType<typeof createModelRequests>,
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      assertActive() {},
    };
    await expect(prepareOutline(args)).rejects.toThrow();
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(h.data()).toEqual(original);
    await expect(prepareOutline({ ...args, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(h.data()).toEqual(original);
    h.data().paper.claims = [];
    const empty = structuredClone(h.data());
    requestJson.mockClear();
    await expect(prepareOutline(args)).rejects.toMatchObject({ code: 'no-findings' });
    expect(requestJson).not.toHaveBeenCalled();
    expect(h.data()).toEqual(empty);
  });
});

describe('M17 大论文自动分批', () => {
  it('保留所有发现与全文，后续批失败不提交半稿，成功仅保存一次', async () => {
    const h = harness();
    const paper = h.data().paper;
    const originalClaim = paper.claims[0];
    const textSource = {
      id: 'text-only-evidence',
      kind: 'text' as const,
      documentId: paper.documents[0].id,
      pageNumber: 1,
      textQuote: paper.blocks[0].text,
      textSpan: { blockId: paper.blocks[0].id, start: 0, end: paper.blocks[0].text.length },
    };
    paper.sources.push(textSource);
    paper.evidences = paper.evidences.map((evidence) => ({ ...evidence, sourceIds: [textSource.id] }));
    paper.claims = Array.from({ length: 96 }, (_, i) => ({
      ...originalClaim,
      id: `long-claim-${i}`,
      text: originalClaim.text + '保留实验条件与证据。'.repeat(130),
    }));
    const originalBlock = paper.blocks[0];
    paper.blocks.push(
      ...Array.from({ length: 15 }, (_, i) => ({
        ...originalBlock,
        id: `unreferenced-${i}`,
        text: '全文尚未关联的实验描述。'.repeat(100),
      })),
    );
    const groups = speechBatches(paper);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.some((group) => group.figures.length > 0)).toBe(true);
    expect(paper.evidences.every((evidence) => evidence.sourceIds.every((id) => id === textSource.id))).toBe(true);
    expect(groups.flatMap((group) => group.claims.map((c) => c.id))).toEqual(paper.claims.map((c) => c.id));
    expect(new Set(groups.flatMap((group) => group.blocks.map((b) => b.id)))).toEqual(
      new Set(paper.blocks.map((b) => b.id)),
    );
    const indexed = speechContext(groups[1], paper);
    const aliased = structuredClone(h.data().target!.content);
    aliased.speech[0].claimIds = ['c33'];
    expect(indexed.decode(aliased).speech[0].claimIds).toEqual([paper.claims[32].id]);
    const before = structuredClone(h.data());
    const save = vi.spyOn(h.store, 'saveGenerated');
    let failLater = true;
    const requestJson = vi.fn(
      async ({
        data,
        stage,
      }: {
        stage: string;
        data: { paper: { claims: { id: string }[] }; sequence: { part: number }; groups?: { id: string }[] };
      }) => {
        if (stage === 'speech-structure')
          return {
            sections: [
              {
                id: 'organized',
                title: '完整主线',
                purpose: '保留全部讲述',
                kind: 'results',
                track: 'main',
                sourceSectionIds: data.groups!.map((p) => p.id),
              },
            ],
            corrections: [],
          };
        if (failLater && data.sequence.part === 2) throw new Error('later batch failed');
        const content = structuredClone(before.target!.content);
        content.speech.forEach((segment, i) => {
          segment.claimIds = i === 0 ? data.paper.claims.map((c) => c.id) : [];
          segment.sourceIds = [];
        });
        return content;
      },
    );
    const input = {
      prompts,
      projectId: paper.projectId,
      store: h.store,
      requests: { requestJson } as unknown as ReturnType<typeof createModelRequests>,
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      assertActive() {},
    };
    await expect(prepareOutline(input)).rejects.toThrow('later batch failed');
    expect(save).not.toHaveBeenCalled();
    expect(h.data()).toEqual(before);
    failLater = false;
    await prepareOutline(input);
    expect(save).toHaveBeenCalledTimes(1);
    expect(uncoveredClaims(h.data().target!.content, paper)).toEqual([]);
    expect(new Set(h.data().target!.content.speech.map((s) => s.id)).size).toBe(h.data().target!.content.speech.length);
  });
});

describe('M17 全稿大纲整理', () => {
  it('分配遗漏只修复一次，重排保留正文身份且拒绝无原句支持的改写', async () => {
    const data = speechFixture();
    const content = data.target!.content;
    const valid = {
      sections: [
        {
          id: 'overview',
          title: '主线',
          purpose: '解释发现',
          kind: 'results',
          track: 'main',
          sourceSectionIds: ['g2'],
        },
        {
          id: 'details',
          title: '补充证据',
          purpose: '保留细节',
          kind: 'study-design',
          track: 'supplement',
          sourceSectionIds: ['g1'],
        },
      ],
      corrections: [],
    };
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({ ...valid, sections: valid.sections.slice(0, 1) })
      .mockResolvedValueOnce(valid);
    const input = {
      prompts,
      content,
      paper: data.paper,
      settings: DEFAULT_SETTINGS,
      requests: { requestJson } as unknown as ReturnType<typeof createModelRequests>,
      signal: new AbortController().signal,
      assertActive() {},
    };
    const result = await organizeSpeech(input);
    expect(requestJson.mock.calls.every(([request]) => request.data.language === content.language)).toBe(true);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(result.speechParagraphs.map((p) => p.id)).toEqual([...content.speechParagraphs].reverse().map((p) => p.id));
    expect(result.speech).toEqual(content.speech);
    expect(result.sections[1].track).toBe('supplement');
    requestJson
      .mockReset()
      .mockResolvedValue({ ...valid, corrections: [{ paragraphId: 'p1', text: '未经原句支持的改写' }] });
    await expect(organizeSpeech(input)).rejects.toThrow('术语修订超出原句支持范围');
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(content).toEqual(data.target!.content);
  });
});
