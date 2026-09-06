import type { Context, Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { requestJson, requestModel, type ModelSettings } from '../../../shared/llm/model';
import type { ApplyRevisionArgs, Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { Project } from '../../project/project.schema';
import type { ChatMessage } from '../assistant.schema';
import type { DeckSession } from '../../deck/DeckSession';
import { prompts, researchPrompt } from '../../../shared/llm/prompts';
import { saveConversation } from '../conversationRepository';
import { layoutRules } from '../../deck/layoutRules';
import { modificationRequest, resolveAiTarget, type AiRecentMessage, type AiTarget } from '../target/resolveTarget';
import { paperReadSchemas, paperReadDescriptions, paperReadTool } from '../tools/paperReadTools';
import { deckReadSchemas, deckReadDescriptions, deckReadTool } from '../tools/deckReadTools';
import { revisionToolSchema } from '../tools/revisionTool';
import { validateAiCandidate } from '../revision/validateRevisionProposal';
import { applyAssistantRevision, type PersistAssistantRevision } from '../revision/applyRevision';

export type AiOutput =
  | { mode: 'answer'; answer: string; summary?: string }
  | ({ mode: 'revision'; answer?: string } & ApplyRevisionArgs);
export const AiIntentSchema = z.strictObject({ mode: z.enum(['answer', 'revision']), needsStrategy: z.boolean() });
function localContext(paper: Paper, deck: Deck, target: AiTarget) {
  const indices = target.slideIds.map((id) => deck.slides.findIndex((slide) => slide.id === id));
  const slides = target.global
    ? deck.slides
    : deck.slides.filter((_, index) => indices.some((position) => Math.abs(index - position) <= 1));
  const claimIds = new Set(slides.flatMap((slide) => slide.claimIds));
  const claims = paper.claims.filter((claim) => claimIds.has(claim.id));
  const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const evidences = paper.evidences.filter((evidence) => evidenceIds.has(evidence.id));
  const figureIds = new Set(
    slides.flatMap((slide) =>
      slide.elements.flatMap((element) => (element.type === 'figure' ? [element.figureId] : [])),
    ),
  );
  const figures = paper.figures.filter((figure) => figureIds.has(figure.id));
  const sourceIds = new Set([
    ...slides.flatMap((slide) => [
      ...slide.sourceIds,
      ...slide.elements.flatMap((element) => ('sourceIds' in element ? element.sourceIds : [])),
    ]),
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
function tool(name: string, description: string, schema: z.ZodType): Tool {
  return { name, description, parameters: z.toJSONSchema(schema) as Tool['parameters'] };
}
export async function runAiRevision({
  settings,
  paper,
  deck: inputDeck,
  session,
  request,
  selectedSlideId,
  selectedElementId,
  recentMessages = [],
  signal,
  projectId = '',
  requestId = crypto.randomUUID(),
  isTaskActive,
  preferences,
  persistRevision,
}: {
  settings: ModelSettings;
  paper: Paper;
  deck: Deck;
  session: DeckSession;
  request: string;
  selectedSlideId?: string;
  selectedElementId?: string;
  recentMessages?: AiRecentMessage[];
  signal: AbortSignal;
  projectId?: string;
  requestId?: string;
  isTaskActive?: () => boolean;
  preferences?: Project['preferences'];
  persistRevision?: PersistAssistantRevision;
}) {
  const deck = structuredClone(inputDeck);
  const baseRevision = deck.revision;
  const assertActive = () => {
    signal.throwIfAborted();
    if (isTaskActive && !isTaskActive()) throw new Error('修改请求已失效');
    if (session.current.id !== deck.id || session.current.revision !== baseRevision)
      throw new Error('当前幻灯片已变化，请基于最新内容重试。');
  };
  assertActive();
  const history = recentMessages.filter((message) => !message.deckId || message.deckId === deck.id).slice(-6);
  const target = resolveAiTarget(request, deck, paper, selectedSlideId, selectedElementId, history);
  const createMessages = (
    answer: string,
    revision?: { summary: string; affectedSlideIds: string[] },
  ): ChatMessage[] => {
    const common = {
      projectId,
      deckId: deck.id,
      baseRevision,
      targetSlideIds: target.slideIds,
      ...(target.elementId ? { targetElementId: target.elementId } : {}),
      createdAt: Date.now(),
    };
    return [
      { ...common, id: `${requestId}-user`, role: 'user', text: request },
      {
        ...common,
        id: `${requestId}-assistant`,
        createdAt: common.createdAt + 1,
        role: 'assistant',
        text: answer,
        ...(revision ? { ...revision, revision: baseRevision + 1 } : {}),
      },
    ];
  };
  const answerResult = async (answer: string) => {
    assertActive();
    const messages = createMessages(answer);
    if (projectId) await saveConversation(projectId, messages, signal, isTaskActive);
    return {
      output: { mode: 'answer' as const, answer },
      committed: false as const,
      messages,
      affectedSlideIds: [] as string[],
    };
  };
  if (target.clarification) return answerResult(target.clarification);
  const data = {
    request,
    layoutRules,
    selectedSlideId,
    selectedElementId,
    boundTarget: {
      ...target,
      allowedScopeTypes: target.elementId
        ? ['slides', 'element']
        : target.global && !target.titleOnly && !target.figureId
          ? ['slides', 'deck']
          : ['slides'],
    },
    recentMessages: history,
    preferences,
    ...localContext(paper, deck, target),
  };
  const prompt = [prompts.common, prompts.stages.ai].join('\n\n');
  // 分类调用没有写工具；请求只读时，后续工具回合也不会提供写工具。
  const intent = await requestJson(
    settings,
    `${prompt}\n当前步骤只识别意图：问题、解释、检查或审核选择 answer；要求实际调整（含“太挤”“短一点”“按刚才建议修改”）选择 revision；只有研究叙事、内容取舍或结构调整需要 needsStrategy。此步骤不执行修改。`,
    data,
    AiIntentSchema,
    signal,
    'ai',
  );
  assertActive();
  if (
    /不要(?:做任何)?修改|不(?:要|用|需)改|只(?:需|要)?(?:解释|回答|检查|审核|建议)|仅(?:解释|回答|检查|审核)|do not (?:edit|change|modify)/i.test(
      modificationRequest(request),
    )
  )
    intent.mode = 'answer';
  const strategy = intent.needsStrategy ? researchPrompt(preferences?.strategyId) : undefined;
  const readSchemas = { ...paperReadSchemas, ...deckReadSchemas };
  const readDescriptions: Record<keyof typeof readSchemas, string> = {
    ...paperReadDescriptions,
    ...deckReadDescriptions,
  };
  const readTools = Object.entries(readSchemas).map(([name, schema]) =>
    tool(name, readDescriptions[name as keyof typeof readSchemas], schema),
  );
  const context: Context = {
    systemPrompt: [
      prompt,
      strategy?.strategy.body,
      intent.mode === 'revision'
        ? '本轮允许按 boundTarget 修改；需要修改时仅调用一次 deck.apply_revision。update-slide（包括标题与布局）必须使用 slides 范围；element 范围只用于替换或删除已绑定元素。工具只暂存候选，随后正常结束并用简短文字交代结果。'
        : '本轮为问答/审核，只有读取权限；直接用文字回答或给出建议。',
    ]
      .filter(Boolean)
      .join('\n\n'),
    tools: [
      ...readTools,
      ...(intent.mode === 'revision'
        ? [
            tool(
              'deck.apply_revision',
              '暂存一批原子修改；一次请求仅可调用一次，正常结束后才保存，scope 不能扩大 boundTarget。',
              revisionToolSchema(target),
            ),
          ]
        : []),
    ],
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          ...data,
          ...(strategy?.fallback
            ? { strategyWarning: '已保存策略不存在，本轮使用 general；不修改项目默认策略。' }
            : {}),
        }),
        timestamp: Date.now(),
      },
    ],
  };
  let candidate: Awaited<ReturnType<typeof validateAiCandidate>> | undefined;
  for (let turn = 0; turn < 10; turn++) {
    assertActive();
    const response = await requestModel(settings, context, signal, 'ai');
    assertActive();
    context.messages.push(response);
    const calls = response.content.filter((block) => block.type === 'toolCall');
    if (calls.length) {
      if (response.stopReason !== 'toolUse') throw new Error('工具回合未完整结束，本次修改未保存');
      for (const call of calls) {
        assertActive();
        let result: unknown;
        if (call.name === 'deck.apply_revision') {
          if (intent.mode !== 'revision' || candidate) throw new Error('本次请求不允许写入或重复提交修改候选');
          candidate = await validateAiCandidate(call.arguments, target, deck, paper);
          result = { staged: true, summary: candidate.args.summary, affectedSlideIds: candidate.affectedSlideIds };
        } else if (Object.hasOwn(paperReadSchemas, call.name))
          result = paperReadTool(call.name as keyof typeof paperReadSchemas, call.arguments, paper);
        else if (Object.hasOwn(deckReadSchemas, call.name)) result = deckReadTool(call.arguments, deck);
        else throw new Error('模型请求了未开放的工具，本次修改未保存');
        context.messages.push({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
          timestamp: Date.now(),
        });
      }
      continue;
    }
    if (response.stopReason !== 'stop') throw new Error('模型回合未正常结束，本次修改未保存');
    const answer = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim();
    if (!candidate) {
      if (!answer) throw new Error('模型未返回回答，请重试');
      return answerResult(intent.mode === 'revision' ? `${answer}\n\n本轮未更改幻灯片。` : answer);
    }
    assertActive();
    const text = answer || '已完成修改。';
    const messages = createMessages(text, {
      summary: candidate.args.summary,
      affectedSlideIds: candidate.affectedSlideIds,
    });
    const committed = await applyAssistantRevision({
      session,
      request: { requestId, projectId, deckId: deck.id, baseRevision },
      args: candidate.args,
      messages,
      signal,
      isTaskActive,
      persistRevision,
    });
    return {
      output: { mode: 'revision' as const, answer: text, ...candidate.args },
      committed: true as const,
      deck: committed,
      messages,
      affectedSlideIds: candidate.affectedSlideIds,
    };
  }
  throw new Error('本次请求读取次数过多，尚未保存修改，请缩小问题范围后重试。');
}
