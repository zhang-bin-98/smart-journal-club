import { Agent } from '@earendil-works/pi-agent-core';
import type { Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { Project } from '../../project/project.schema';
import type { DeckSession } from '../../deck/DeckSession';
import type { ChatMessage } from '../assistant.schema';
import { model, type ModelSettings } from '../../../shared/llm/model';
import { prompts, researchPrompt } from '../../../shared/llm/prompts';
import { saveConversation } from '../conversationRepository';
import { layoutRules } from '../../deck/layoutRules';
import { resolveAiTarget, type AiRecentMessage, type AiTarget } from '../target/resolveTarget';
import { createTools, proposalToolName } from '../tools/createTools';
import { validateAiCandidate } from '../revision/validateRevisionProposal';
import type { PendingRevision } from '../revision/applyProposal';
import { AssistantError } from '../assistantError';
import { assistantStream } from './modelStream';

export type AssistantProgress = { status: string; text?: string };
function localContext(paper: Paper, deck: Deck, target: AiTarget) {
  const indices = target.slideIds.map((id) => deck.slides.findIndex((slide) => slide.id === id));
  const slides = target.global
    ? deck.slides
    : deck.slides.filter((_, index) => indices.some((position) => Math.abs(index - position) <= 1));
  const claims = paper.claims.filter((claim) => slides.some((slide) => slide.claimIds.includes(claim.id)));
  const evidences = paper.evidences.filter((evidence) =>
    claims.some((claim) => claim.evidenceIds.includes(evidence.id)),
  );
  const figures = paper.figures.filter((figure) =>
    slides.some((slide) =>
      slide.elements.some((element) => element.type === 'figure' && element.figureId === figure.id),
    ),
  );
  const sourceIds = new Set([
    ...slides.flatMap((slide) => slide.sourceIds),
    ...evidences.flatMap((evidence) => evidence.sourceIds),
    ...figures.flatMap((figure) => [figure.sourceId, ...figure.panels.map((panel) => panel.sourceId)]),
  ]);
  return {
    deck: {
      id: deck.id,
      revision: deck.revision,
      title: deck.title,
      language: deck.language,
      sections: deck.sections,
      slides,
    },
    paper: {
      metadata: paper.metadata,
      studyProfile: paper.studyProfile,
      claims,
      evidences,
      figures,
      sources: paper.sources.filter((source) => sourceIds.has(source.id)),
    },
  };
}

/** Agent 只读取快照并生成候选；正常完成也不提交 Deck。 */
export async function runAiRevision({
  settings,
  paper,
  deck: inputDeck,
  session,
  mode,
  request,
  selectedSlideId,
  selectedElementId,
  recentMessages = [],
  signal,
  projectId = '',
  requestId = crypto.randomUUID(),
  isTaskActive,
  preferences,
  target: boundTarget,
  onProgress,
}: {
  settings: ModelSettings;
  paper: Paper;
  deck: Deck;
  session: DeckSession;
  mode: 'answer' | 'revision';
  request: string;
  selectedSlideId?: string;
  selectedElementId?: string;
  recentMessages?: AiRecentMessage[];
  signal: AbortSignal;
  projectId?: string;
  requestId?: string;
  isTaskActive?: () => boolean;
  preferences?: Project['preferences'];
  target?: AiTarget;
  onProgress?: (progress: AssistantProgress) => void;
}) {
  const deck = structuredClone(inputDeck);
  const assertActive = () => {
    signal.throwIfAborted();
    if (isTaskActive && !isTaskActive()) throw new AssistantError('inactive-task', '本次请求已失效');
    if (session.current.id !== deck.id || session.current.revision !== deck.revision)
      throw new AssistantError('stale-revision', '当前幻灯片已变化，请基于最新内容重试。');
  };
  assertActive();
  const history = recentMessages.filter((message) => !message.deckId || message.deckId === deck.id).slice(-6);
  const target = structuredClone(
    boundTarget ?? resolveAiTarget(request, deck, paper, selectedSlideId, selectedElementId, history),
  );
  const messagesFor = (answer: string): ChatMessage[] => {
    const common = {
      projectId,
      deckId: deck.id,
      baseRevision: deck.revision,
      targetSlideIds: target.slideIds,
      ...(target.elementId ? { targetElementId: target.elementId } : {}),
      createdAt: Date.now(),
    };
    return [
      { ...common, id: `${requestId}-user`, role: 'user', text: request },
      { ...common, id: `${requestId}-assistant`, createdAt: common.createdAt + 1, role: 'assistant', text: answer },
    ];
  };
  const answerResult = async (answer: string) => {
    assertActive();
    const messages = messagesFor(answer);
    if (projectId) await saveConversation(projectId, messages, signal, isTaskActive);
    return { messages, proposal: undefined as PendingRevision | undefined };
  };
  if (target.clarification) return answerResult(target.clarification);
  let candidate: Awaited<ReturnType<typeof validateAiCandidate>> | undefined;
  let failure: AssistantError | undefined;
  let turns = 0;
  let calls = 0;
  let writes = 0;
  let text = '';
  const tools = createTools({
    paper,
    deck,
    target,
    mode,
    propose: async (raw) => {
      assertActive();
      candidate = await validateAiCandidate(raw, target, deck, paper);
      assertActive();
      return { proposed: true, summary: candidate.args.summary, affectedSlideIds: candidate.affectedSlideIds };
    },
  });
  const strategy = mode === 'revision' && !target.titleOnly ? researchPrompt(preferences?.strategyId) : undefined;
  const agent = new Agent({
    initialState: {
      model,
      tools,
      systemPrompt: [
        prompts.common,
        prompts.stages.ai,
        strategy?.strategy.body,
        mode === 'revision'
          ? '本轮仅可按 boundTarget 拟定一个提案；调用 deck_propose_revision 后等待用户应用，不能声称已经保存。'
          : '本轮是提问，只有读取权限；回答或提出建议。',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    streamFn: assistantStream(settings),
    toolExecution: 'sequential',
    beforeToolCall: async ({ toolCall }) => {
      try {
        assertActive();
        calls += 1;
        if (calls > 20) throw new AssistantError('tool-budget', '本次读取次数过多，请缩小问题范围。');
        if (toolCall.name === proposalToolName && (mode !== 'revision' || ++writes > 1))
          throw new AssistantError('duplicate-proposal', '本次请求不允许写入或重复拟定提案。');
        if (failure) throw failure;
        return undefined;
      } catch (cause) {
        failure = cause instanceof AssistantError ? cause : new AssistantError('inactive-task', '本次请求已失效');
        return { block: true, reason: failure.message, terminate: true };
      }
    },
    afterToolCall: async ({ isError }) => {
      if (isError)
        failure = new AssistantError('invalid-tool-result', '工具请求未通过范围、来源或布局检查，请调整要求后重试。');
      return { terminate: !!candidate || !!failure };
    },
    shouldStopAfterTurn: ({ context }) => {
      turns += 1;
      if (!candidate && (turns >= 10 || JSON.stringify(context.messages).length > 240000))
        failure = new AssistantError('context-budget', '本次请求超出读取预算，请缩小问题范围。');
      return !!candidate || !!failure;
    },
  });
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'agent_start') onProgress?.({ status: '正在分析' });
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      text += event.assistantMessageEvent.delta;
      onProgress?.({ status: '正在回答', text });
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update')
      onProgress?.({ status: tools.find((tool) => tool.name === event.toolName)?.label ?? '正在核对' });
    if (event.type === 'tool_execution_end' && event.isError)
      failure = new AssistantError('invalid-tool', '模型请求了无效工具或参数，本次没有产生可应用提案。');
    if (event.type === 'agent_end') onProgress?.({ status: '已完成' });
  });
  const abort = () => agent.abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    assertActive();
    await agent.prompt(
      JSON.stringify({
        request,
        mode,
        layoutRules,
        boundTarget: target,
        recentMessages: history,
        preferences,
        ...localContext(paper, deck, target),
      }),
    );
    assertActive();
    if (failure) throw failure;
    if (agent.state.errorMessage) throw new AssistantError('model-request', agent.state.errorMessage);
    const last = [...agent.state.messages].reverse().find((message) => message.role === 'assistant');
    if (!candidate) {
      if (last?.role !== 'assistant' || last.stopReason !== 'stop')
        throw new AssistantError('incomplete-response', '模型未正常完成回答，请重试。');
      const answer = last.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      if (!answer) throw new AssistantError('empty-response', '模型未返回回答，请重试。');
      return answerResult(answer);
    }
    const messages = messagesFor('修改提案已准备，等待应用。');
    const proposal: PendingRevision = {
      ...candidate.args,
      requestId,
      projectId,
      deckId: deck.id,
      baseRevision: deck.revision,
      affectedSlideIds: candidate.affectedSlideIds,
      createdAt: Date.now(),
      target,
      messages,
      preview: candidate.preview,
    };
    return { messages: [] as ChatMessage[], proposal };
  } finally {
    signal.removeEventListener('abort', abort);
    unsubscribe();
  }
}
