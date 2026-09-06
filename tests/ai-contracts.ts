import { DeckSession, type PersistRevision } from '../src/modules/deck/DeckSession';
import type { RevisionRequest } from '../src/modules/deck/deck.schema';
import { fixtureDeck, fixturePaper } from './fixtures';
import { resolveAiTarget } from '../src/modules/assistant/target/resolveTarget';
import { validateAiCandidate } from '../src/modules/assistant/revision/validateRevisionProposal';
import { runAiRevision } from '../src/modules/assistant/runtime/runAssistant';
import { applyProposal } from '../src/modules/assistant/revision/applyProposal';
import { narrativeDeck } from './narrative-fixture';
import { DEFAULT_SETTINGS } from '../src/shared/llm/model';
import { createProject, deleteProject, loadProject, saveStage } from '../src/modules/project/projectRepository';
import { saveRevision } from '../src/modules/deck/deckRepository';
import { loadHistory, saveConversation } from '../src/modules/assistant/conversationRepository';
import { DeckSchema, type ApplyRevisionArgs, type Deck } from '../src/modules/deck/deck.schema';
import type { ChatMessage } from '../src/modules/assistant/assistant.schema';
import { transaction } from '../src/shared/persistence/indexedDb';

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function rejected(work: () => unknown | Promise<unknown>, message: string) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, message);
}
const batch: ApplyRevisionArgs = {
  scope: { type: 'slides', slideIds: ['slide-1', 'slide-2'] },
  summary: '同时精简两页标题',
  mutations: [
    { type: 'update-slide', slideId: 'slide-1', changes: { title: '第一处 AI 修改' } },
    { type: 'update-slide', slideId: 'slide-2', changes: { title: '第二处 AI 修改' } },
  ],
};
function capture(projectId: string, deck: Deck): RevisionRequest {
  return { requestId: crypto.randomUUID(), projectId, deckId: deck.id, baseRevision: deck.revision };
}
async function createFixture() {
  let project = await createProject(new File(['%PDF-fixture'], 'ai-contract.pdf'));
  const paper = { ...structuredClone(fixturePaper), id: project.paperId };
  const signal = new AbortController().signal;
  project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
  project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
  project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
  const deck = DeckSchema.parse({ ...structuredClone(fixtureDeck), id: crypto.randomUUID(), paperId: paper.id });
  project = { ...project, checkpoint: 'deck-ready', currentDeckId: deck.id };
  await transaction(['projects', 'decks'], 'readwrite', async (tx) => {
    tx.objectStore('projects').put(project, project.id);
    tx.objectStore('decks').put(deck, deck.id);
  });
  return { project, paper, deck };
}

export async function runAiContracts() {
  const { project, paper, deck } = await createFixture();
  try {
    const persist: PersistRevision = (previous, next, record, options) =>
      saveRevision(project.id, previous, next, record, options?.signal, options);
    const messagesPersist =
      (messages: ChatMessage[]): PersistRevision =>
      (previous, next, record, options) =>
        saveRevision(project.id, previous, next, record, options?.signal, {
          isTaskActive: options?.isTaskActive,
          messages,
        });
    const session = new DeckSession(deck, paper, persist, project.id);
    const request = capture(project.id, deck);
    const messages: ChatMessage[] = [
      {
        id: crypto.randomUUID(),
        projectId: project.id,
        deckId: deck.id,
        baseRevision: deck.revision,
        role: 'user',
        text: '精简前两页标题',
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        projectId: project.id,
        deckId: deck.id,
        baseRevision: deck.revision,
        role: 'assistant',
        text: '已精简两页标题。',
        summary: batch.summary,
        revision: 1,
        affectedSlideIds: ['slide-1', 'slide-2'],
        createdAt: Date.now() + 1,
      },
    ];
    await session.applyRevision(request, batch, { persist: messagesPersist(messages) });
    assert(
      session.current.revision === 1 &&
        session.current.slides[0].title === '第一处 AI 修改' &&
        session.current.slides[1].title === '第二处 AI 修改',
      '多页修改必须一次提交',
    );
    assert((await loadHistory(project.id)).length === 2, '用户消息和摘要须随修改持久化');
    await rejected(
      () => session.applyRevision({ ...capture(project.id, session.current), requestId: request.requestId }, batch),
      '重复 requestId 即使使用新 revision 也必须拒绝',
    );
    assert(session.current.revision === 1, '重复请求不得推进版本');
    await session.undo();
    assert(
      session.current.revision === 2 &&
        session.current.slides.every((slide, index) => slide.title === deck.slides[index].title) &&
        !session.canUndo,
      '一次 Undo 应恢复整批内容并递增 revision',
    );
    await rejected(() => session.applyRevision(capture(project.id, deck), batch), '绑定旧版本的 AI 候选不得提交');

    const stable = JSON.stringify(session.current);
    const historyCount = (await loadHistory(project.id)).length;
    const nextMessages = messages.map((message) => ({
      ...message,
      id: crypto.randomUUID(),
      baseRevision: session.current.revision,
      ...(message.revision === undefined ? {} : { revision: session.current.revision + 1 }),
    }));
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'history' && 'role' in args[0])
        throw new DOMException('fixed summary failure', 'QuotaExceededError');
      return originalAdd.apply(this, args);
    };
    try {
      await rejected(
        () =>
          session.applyRevision(capture(project.id, session.current), batch, {
            persist: messagesPersist(nextMessages),
          }),
        '摘要写入失败必须回滚整批修改',
      );
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    assert(
      JSON.stringify(session.current) === stable && JSON.stringify((await loadProject(project.id)).deck) === stable,
      '摘要失败不得留下内存或数据库半提交',
    );
    assert((await loadHistory(project.id)).length === historyCount, '摘要失败不得留下部分对话');

    const controller = new AbortController();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = originalPut.apply(this, args);
      if (this.name === 'decks') controller.abort();
      return result;
    };
    try {
      await rejected(
        () =>
          session.applyRevision(capture(project.id, session.current), batch, {
            signal: controller.signal,
            persist: messagesPersist(nextMessages),
          }),
        '事务写入期间取消必须回滚',
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    let active = true;
    IDBObjectStore.prototype.put = function (...args) {
      const result = originalPut.apply(this, args);
      if (this.name === 'decks') active = false;
      return result;
    };
    try {
      await rejected(
        () => session.applyRevision(capture(project.id, session.current), batch, { isTaskActive: () => active }),
        '事务写入期间失效必须回滚',
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    assert(
      JSON.stringify((await loadProject(project.id)).deck) === stable && !session.canUndo,
      '取消和失效不得前进内容或撤销栈',
    );
    const conversation = Array.from(
      { length: 105 },
      (_, index): ChatMessage => ({
        id: crypto.randomUUID(),
        projectId: project.id,
        deckId: deck.id,
        baseRevision: session.current.revision,
        role: 'assistant',
        text: `固定回答 ${index}`,
        createdAt: Date.now() + index + 100,
      }),
    );
    await saveConversation(project.id, conversation);
    const history = await loadHistory(project.id);
    assert(
      history.length === 100 && history[0].text === '固定回答 5' && history.at(-1)?.text === '固定回答 104',
      '可见历史仅保留最近 100 条',
    );
    assert(JSON.stringify((await loadProject(project.id)).deck) === stable, '问答历史不应改写 Deck 或 revision');
    await rejected(
      () => session.applyRevision({ ...capture(project.id, session.current), requestId: request.requestId }, batch),
      '新增对话不得挤掉请求去重记录',
    );
  } finally {
    await deleteProject(project.id);
  }
  const remaining = await new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('smartjc', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('history');
      const all = tx.objectStore('history').getAll();
      all.onsuccess = () => resolve(all.result.filter((item) => item.projectId === project.id).length);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
  assert(remaining === 0, '删除项目应清理对话和请求记录');
  await runAiModelContracts();
  return 'PASS: AI targets/read-only tools/staged failure and cancel/batch undo/stale and duplicate requests/atomic bounded history';
}

type WireSchema = { properties?: Record<string, WireSchema>; const?: unknown; enum?: unknown[]; items?: WireSchema };
type WireRequest = {
  tools: { function: { name: string; parameters?: WireSchema } }[];
  messages: { role: string; content?: string }[];
};
function event(delta: unknown, reason: string) {
  const chunk = (value: unknown, finish_reason: string | null) =>
    `data: ${JSON.stringify({ id: 'fixed-ai', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`;
  return new Response(
    `${chunk({ role: 'assistant', ...(delta as object) }, null) + chunk({}, reason)}data: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
function call(name: string, args: unknown) {
  return event(
    {
      tool_calls: [
        {
          index: 0,
          id: crypto.randomUUID(),
          type: 'function',
          function: { name: name.replaceAll('.', '__'), arguments: JSON.stringify(args) },
        },
      ],
    },
    'tool_calls',
  );
}
const answer = (text = '固定回答') => event({ content: text }, 'stop');
async function fixedResponses(steps: (() => Response | Promise<Response>)[], work: () => Promise<unknown>) {
  const originalFetch = globalThis.fetch;
  const requests: WireRequest[] = [];
  let used = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith('https://api.deepseek.com/')) return originalFetch(input, init);
    requests.push(JSON.parse(await request.text()) as WireRequest);
    const step = steps[used++];
    if (!step) throw new Error('固定响应已用尽');
    return step();
  };
  try {
    await work();
    assert(used === steps.length, '应实际执行所有固定工具回合');
    return requests;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
async function runAiModelContracts() {
  const deck = narrativeDeck();
  deck.slides.forEach((slide, index) => {
    slide.id = `slide-${index + 1}`;
  });
  const paper = structuredClone(fixturePaper);
  const titleRequest = '请把第1页标题改为“酵母交配信号重新激活 TORC1”，只修改第1页标题，其他内容保持原样。';
  assert(
    resolveAiTarget(titleRequest, deck, paper, 'slide-3').titleOnly === true,
    '保留其他内容的约束不得扩大标题修改范围',
  );
  assert(
    resolveAiTarget('只修改第1页标题，不要修改其他内容', deck, paper, 'slide-3').titleOnly === true,
    '否定其他内容修改时仍是标题请求',
  );
  const target = resolveAiTarget('第 1 页标题短一点', deck, paper, 'slide-2', 'f1');
  assert(target.slideIds.join() === 'slide-1' && !target.elementId, '显式页码必须优先于选中页和元素');
  assert(
    resolveAiTarget('第一至二页标题短一点', deck, paper, 'slide-3').slideIds.join() === 'slide-1,slide-2',
    '中文连续页码应按当前页序定位',
  );
  assert(
    resolveAiTarget('第 99 页标题短一点', deck, paper, 'slide-1').clarification,
    '越界页码应澄清而不是回退到当前页',
  );
  assert(
    resolveAiTarget('Figure 3 只留 A', fixtureDeck, paper, 'slide-1').clarification,
    '重复 Figure 没有可消歧选择时应澄清',
  );
  assert(
    resolveAiTarget('这页简短一些', deck, paper, 'slide-2', undefined, [
      { role: 'assistant', text: '上次建议', targetSlideIds: ['slide-1'] },
    ]).slideIds.join() === 'slide-2',
    '这页必须使用当前选择',
  );
  assert(
    resolveAiTarget('按刚才建议修改', deck, paper, undefined, undefined, [
      { role: 'assistant', text: '上次建议', targetSlideIds: ['slide-2'] },
    ]).slideIds.join() === 'slide-2',
    '没有当前选择时应使用最近目标',
  );
  const local: ApplyRevisionArgs = {
    scope: { type: 'slides', slideIds: ['slide-1'] },
    summary: '精简标题',
    mutations: [batch.mutations[0]],
  };
  await rejected(
    () => validateAiCandidate({ ...local, scope: { type: 'deck' } }, target, deck, paper),
    '局部请求不能用 deck scope 绕过范围检查',
  );
  await rejected(
    () =>
      validateAiCandidate(
        { ...local, scope: { type: 'element', slideId: 'slide-1', elementId: 't1' } },
        target,
        deck,
        paper,
      ),
    '页面标题的 update-slide 不能以 element 范围提交',
  );
  await rejected(
    () => validateAiCandidate({ ...local, mutations: [batch.mutations[1]] }, target, deck, paper),
    '局部请求不得改选中页来替代显式页码',
  );
  await rejected(
    () =>
      validateAiCandidate(
        {
          ...local,
          mutations: [
            { type: 'replace-element', slideId: 'slide-1', element: { id: 't1', type: 'text', text: '偷偷改正文' } },
          ],
        },
        target,
        deck,
        paper,
      ),
    '标题微调不能扩散到正文',
  );
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'fixed-test-key' };
  const run = (
    session: DeckSession,
    signal = new AbortController().signal,
    request = '第 1 页标题短一点',
    mode: 'answer' | 'revision' = 'revision',
  ) =>
    runAiRevision({
      settings,
      paper,
      deck: session.current,
      session,
      signal,
      request,
      mode,
      selectedSlideId: 'slide-2',
      selectedElementId: 'f1',
    });

  const readSession = new DeckSession(deck, paper);
  const readRequests = await fixedResponses(
    [() => call('paper_get_figure', { figureId: 'fig-3' }), () => answer('图源可以在原文第一页核对。')],
    () => run(readSession, undefined, '检查这页的证据', 'answer'),
  );
  assert(
    readRequests.every((request) => !request.tools.some((tool) => tool.function.name === 'deck_propose_revision')),
    '问答回合不得开放写工具',
  );
  assert(
    readRequests[1].messages.some((message) => message.role === 'tool' && message.content?.includes('fig-3')),
    '读取工具必须使用当前论文数据',
  );
  assert(readSession.current.revision === 0 && !readSession.canUndo, '问答和读工具不能写入');
  await fixedResponses([() => call('deck_propose_revision', local)], () =>
    rejected(() => run(readSession, undefined, '检查标题', 'answer'), '问答中伪造写工具调用必须拒绝'),
  );
  assert(readSession.current.revision === 0, '问答伪造写调用不得提交');

  const success = new DeckSession(deck, paper);
  let proposal: Awaited<ReturnType<typeof run>>['proposal'];
  const titleRequests = await fixedResponses([() => call('deck_propose_revision', local)], async () => {
    proposal = (await run(success, undefined, titleRequest)).proposal;
  });
  const writeScope = titleRequests[0].tools.find((tool) => tool.function.name === 'deck_propose_revision')?.function
    .parameters?.properties?.scope;
  assert(
    writeScope?.properties?.type?.const === 'slides' &&
      !JSON.stringify(writeScope).includes('element') &&
      writeScope.properties.slideIds.items?.enum?.join() === 'slide-1',
    '标题请求的写工具只应提供绑定目标页的 slides 范围',
  );
  assert(proposal && success.current.revision === 0 && !success.canUndo, '提案等待用户应用，不改版本或 Undo');
  if (!proposal) throw new Error('缺少提案');
  const apply = () =>
    applyProposal({
      proposal: proposal!,
      session: success,
      paper,
      signal: new AbortController().signal,
      isTaskActive: () => true,
    });
  await apply();
  assert(
    success.current.revision === 1 &&
      success.current.slides[0].title === '第一处 AI 修改' &&
      success.current.slides[1].title === deck.slides[1].title,
    '用户应用后才修改显式目标',
  );
  await rejected(apply, '重复应用同一提案必须拒绝');
  await success.undo();
  assert(!success.canUndo && success.current.slides[0].title === deck.slides[0].title, '一次 AI 请求只产生一次 Undo');
  for (const failure of ['network', 'cancel', 'duplicate', 'stale'] as const) {
    const session = new DeckSession(deck, paper);
    const controller = new AbortController();
    await fixedResponses(
      [
        async () => {
          assert(session.current.revision === 0, '失败前候选不能提前提交');
          if (failure === 'network')
            return new Response('{"error":{"message":"fixed failure"}}', {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          if (failure === 'cancel') controller.abort();
          if (failure === 'duplicate')
            return event(
              {
                tool_calls: [0, 1].map((index) => ({
                  index,
                  id: `duplicate-${index}`,
                  type: 'function',
                  function: { name: 'deck_propose_revision', arguments: JSON.stringify(local) },
                })),
              },
              'tool_calls',
            );
          if (failure === 'stale')
            await session.commit(
              { type: 'slides', slideIds: ['slide-3'] },
              [{ type: 'update-slide', slideId: 'slide-3', changes: { title: '新的手工内容' } }],
              '手工修改',
            );
          return call('deck_propose_revision', local);
        },
      ],
      () => rejected(() => run(session, controller.signal), `失败、取消、重复调用或旧响应必须丢弃候选：${failure}`),
    );
    assert(
      session.current.slides[0].title === deck.slides[0].title &&
        session.current.revision === (failure === 'stale' ? 1 : 0),
      `失败请求不得留下 AI 内容或版本：${failure}`,
    );
  }
  const pendingSession = new DeckSession(deck, paper);
  await fixedResponses([() => call('deck_propose_revision', local)], async () => {
    const pending = (await run(pendingSession)).proposal;
    if (!pending) throw new Error('缺少待应用提案');
    const options = {
      proposal: pending,
      session: pendingSession,
      paper,
      signal: new AbortController().signal,
      isTaskActive: () => false,
    };
    await rejected(() => applyProposal(options), '手工草稿或切换项目失效后不能应用');
    await pendingSession.commit(
      { type: 'slides', slideIds: ['slide-3'] },
      [{ type: 'update-slide', slideId: 'slide-3', changes: { title: '新手工稿' } }],
      '手工修改',
    );
    await rejected(() => applyProposal({ ...options, isTaskActive: () => true }), '已展示提案的旧 revision 不能应用');
    assert(pendingSession.current.slides[0].title === deck.slides[0].title, '过期提案没有提交');
  });
}
