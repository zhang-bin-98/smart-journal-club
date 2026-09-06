import type { Context, Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { requestJson, requestModel, type ModelSettings } from './model';
import { ApplyRevisionArgsSchema, DeckMutationSchema, RevisionScopeSchema, type ApplyRevisionArgs, type ChatMessage, type Deck, type Paper, type Project } from './types';
import { DeckSession } from './deck';
import { prompts, researchPrompt } from './prompts';
import { saveConversation } from './storage';
import { layoutRules } from './generation';

export type AiRecentMessage = { role: string; text: string; deckId?: string; baseRevision?: number; revision?: number; targetSlideIds?: string[]; targetElementId?: string };
export type AiTarget = { slideIds: string[]; global: boolean; elementId?: string; figureId?: string; titleOnly?: boolean; allowNewSlides: boolean; clarification?: string };
export type AiOutput = { mode: 'answer'; answer: string; summary?: string } | ({ mode: 'revision'; answer?: string } & ApplyRevisionArgs);
export const AiIntentSchema = z.strictObject({ mode: z.enum(['answer', 'revision']), needsStrategy: z.boolean() });
// 保留其他内容的限制不应被识别为另一项修改或整轮只读要求。
function modificationRequest(request: string) {
  return request.replace(/(?:其他|其余)[^，。；\n]*(?:保持|不变|不要|不改|不修改)[^，。；\n]*/g, '')
    .replace(/(?:不要|不需|不用|不)(?:修改|改动|改|动)(?:其他|其余)[^，。；\n]*/g, '');
}
const numberPattern = '[0-9零一二两三四五六七八九十百]+';
function pageNumber(text: string) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0; let value = 0;
  for (const char of text) { if (char === '十' || char === '百') { total += (value || 1) * (char === '十' ? 10 : 100); value = 0; } else value = digits[char] ?? 0; }
  return total + value;
}
function explicitPages(request: string) {
  const pages: number[] = [];
  for (const match of request.matchAll(new RegExp(`第\\s*(${numberPattern})(?:\\s*[-—–到至]\\s*(${numberPattern}))?\\s*页|(?:slide|page)\\s*(\\d+)`, 'gi'))) {
    const first = pageNumber(match[1] ?? match[3]); const last = match[2] ? pageNumber(match[2]) : first;
    if (last < first || last - first > 100) return [0];
    for (let page = first; page <= last; page++) pages.push(page);
  }
  const list = request.match(new RegExp(`第\\s*(${numberPattern}(?:\\s*[、,，和及]\\s*${numberPattern})+)\\s*页`));
  if (list) for (const value of list[1].matchAll(new RegExp(numberPattern, 'g'))) pages.push(pageNumber(value[0]));
  const leading = request.match(new RegExp(`前\\s*(${numberPattern})\\s*页`));
  if (leading) { const count = pageNumber(leading[1]); if (count > 100) return [0]; for (let page = 1; page <= count; page++) pages.push(page); }
  return [...new Set(pages)];
}
export function resolveSlideTarget(request: string, deck: Deck, selectedSlideId?: string) {
  const pages = explicitPages(request);
  return pages.length ? deck.slides[pages[0] - 1]?.id : deck.slides.find(slide => slide.id === selectedSlideId)?.id ?? deck.slides[0]?.id;
}
export function resolveAiTarget(request: string, deck: Deck, paper: Paper, selectedSlideId?: string, selectedElementId?: string, recentMessages: AiRecentMessage[] = []): AiTarget {
  const pages = explicitPages(request);
  const global = !pages.length && /整体|全部|所有|整套|全局|每一页|全篇|entire deck|all slides/i.test(request);
  const target: AiTarget = { slideIds: [], global, allowNewSlides: global || /新增|添加|插入|拆|分成|压成|合并|太挤|压到|增加.*页/.test(request) };
  if (!deck.slides.length && /这(?:一)?页|当前页|本页|这张图/.test(request)) return { ...target, clarification: '当前文稿没有幻灯片，请先新增页面或明确要创建的内容。' };
  if (pages.some(page => !deck.slides[page - 1])) return { ...target, clarification: '指定页码超出当前幻灯片范围，请提供有效页码。' };
  if (pages.length) target.slideIds = pages.map(page => deck.slides[page - 1].id);
  else if (global) target.slideIds = deck.slides.map(slide => slide.id);
  else if (/这(?:一)?页|当前页|本页/.test(request)) target.slideIds = [resolveSlideTarget(request, deck, selectedSlideId)].filter((id): id is string => !!id);
  else {
    const sections = [{ pattern: /背景/, kinds: ['background'] }, { pattern: /研究问题/, kinds: ['question'] }, { pattern: /方法/, kinds: ['method'] }, { pattern: /结果部分|结果页/, kinds: ['result'] }, { pattern: /讨论部分|讨论页/, kinds: ['discussion'] }, { pattern: /结论部分|结论页/, kinds: ['conclusion'] }];
    const section = sections.find(item => item.pattern.test(request));
    if (section) {
      target.slideIds = deck.slides.filter(slide => section.kinds.includes(slide.kind)).map(slide => slide.id);
      if (!target.slideIds.length) return { ...target, clarification: '当前文稿中没有找到指定部分，请提供要调整的页码。' };
    }
  }
  const figureMatch = request.match(/(?:Figure|Fig\.?|图)\s*(\d+)/i);
  if (figureMatch) {
    const figures = paper.figures.filter(figure => (figure.label?.match(/\d+/)?.[0] === figureMatch[1]));
    if (figures.length !== 1) return { ...target, clarification: '无法唯一定位这个 Figure，请提供原论文图号及所在幻灯片页码。' };
    target.figureId = figures[0].id;
    let occurrences = deck.slides.filter(slide => slide.elements.some(element => element.type === 'figure' && element.figureId === target.figureId));
    if (target.slideIds.length) occurrences = occurrences.filter(slide => target.slideIds.includes(slide.id));
    else {
      const selected = occurrences.find(slide => slide.id === selectedSlideId);
      if (selected) occurrences = [selected];
      else {
        const previous = [...recentMessages].reverse().find(message => message.targetSlideIds?.length && (!message.deckId || message.deckId === deck.id));
        const recent = occurrences.filter(slide => previous?.targetSlideIds?.includes(slide.id));
        if (recent.length === 1) occurrences = recent;
      }
    }
    if (!occurrences.length) return { ...target, clarification: '指定范围中没有这个 Figure，请提供它所在的幻灯片页码。' };
    if (!target.slideIds.length && occurrences.length > 1) return { ...target, clarification: `这个 Figure 出现在第 ${occurrences.map(slide => deck.slides.indexOf(slide) + 1).join('、')} 页，请指定要调整哪一处。` };
    target.slideIds = occurrences.map(slide => slide.id);
  }
  if (!target.slideIds.length && selectedSlideId && deck.slides.some(slide => slide.id === selectedSlideId)) target.slideIds = [selectedSlideId];
  if (!target.slideIds.length) {
    const previous = [...recentMessages].reverse().find(message => message.targetSlideIds?.some(id => deck.slides.some(slide => slide.id === id)) && (!message.deckId || message.deckId === deck.id));
    target.slideIds = previous?.targetSlideIds?.filter(id => deck.slides.some(slide => slide.id === id)) ?? (deck.slides[0] ? [deck.slides[0].id] : []);
  }
  const changes = modificationRequest(request);
  target.titleOnly = /标题|title/i.test(changes) && !/正文|内容|布局|图|拆|新增|添加/.test(changes);
  const selectedSlide = deck.slides.find(slide => slide.id === selectedSlideId && target.slideIds.includes(slide.id));
  if (!target.titleOnly && !target.figureId && !pages.length && !global && !/这(?:一)?页|当前页|本页|背景|研究问题|方法|结果页/.test(request)) {
    if (selectedSlide?.elements.some(element => element.id === selectedElementId)) target.elementId = selectedElementId;
    else if (!selectedSlideId) {
      const previous = [...recentMessages].reverse().find(message => message.targetElementId && message.targetSlideIds?.some(id => target.slideIds.includes(id)));
      if (deck.slides.some(slide => target.slideIds.includes(slide.id) && slide.elements.some(element => element.id === previous?.targetElementId))) target.elementId = previous?.targetElementId;
    }
  }
  return target;
}
function localContext(paper: Paper, deck: Deck, target: AiTarget) {
  const indices = target.slideIds.map(id => deck.slides.findIndex(slide => slide.id === id));
  const slides = target.global ? deck.slides : deck.slides.filter((_, index) => indices.some(position => Math.abs(index - position) <= 1));
  const claimIds = new Set(slides.flatMap(slide => slide.claimIds));
  const claims = paper.claims.filter(claim => claimIds.has(claim.id));
  const evidenceIds = new Set(claims.flatMap(claim => claim.evidenceIds));
  const evidences = paper.evidences.filter(evidence => evidenceIds.has(evidence.id));
  const figureIds = new Set(slides.flatMap(slide => slide.elements.flatMap(element => element.type === 'figure' ? [element.figureId] : [])));
  const figures = paper.figures.filter(figure => figureIds.has(figure.id));
  const sourceIds = new Set([...slides.flatMap(slide => [...slide.sourceIds, ...slide.elements.flatMap(element => 'sourceIds' in element ? element.sourceIds : [])]), ...evidences.flatMap(evidence => evidence.sourceIds), ...figures.flatMap(figure => [figure.sourceId, ...figure.panels.map(panel => panel.sourceId)])]);
  return { deck: { id: deck.id, revision: deck.revision, title: deck.title, language: deck.language, slides }, paper: { metadata: paper.metadata, studyProfile: paper.studyProfile, claims, evidences, figures, sources: paper.sources.filter(source => sourceIds.has(source.id)) } };
}
const readSchemas = {
  'paper.get': z.strictObject({}),
  'paper.get_page': z.strictObject({ pageNumber: z.number().int().positive() }),
  'paper.get_figure': z.strictObject({ figureId: z.string().min(1) }),
  'paper.get_claim': z.strictObject({ claimId: z.string().min(1) }),
  'deck.get': z.strictObject({ slideIds: z.array(z.string().min(1)).min(1).optional() }),
};
const descriptions: Record<keyof typeof readSchemas, string> = {
  'paper.get': '读取当前论文概要及 Figure/Claim 索引，不返回全文。',
  'paper.get_page': '读取当前论文一个 PDF 页的文本。',
  'paper.get_figure': '按原论文 Figure ID 读取图注、Panel 及来源。',
  'paper.get_claim': '读取一个 Claim、对应 Evidence 和 Source。',
  'deck.get': '按稳定 Slide ID 读取必要页面；不传 slideIds 时只返回当前文稿目录。',
};
function tool(name: string, description: string, schema: z.ZodType): Tool { return { name, description, parameters: z.toJSONSchema(schema) as Tool['parameters'] }; }
function readTool(name: keyof typeof readSchemas, args: unknown, paper: Paper, deck: Deck) {
  const parsed = readSchemas[name].parse(args);
  if (name === 'paper.get') return { metadata: paper.metadata, studyProfile: paper.studyProfile, pageCount: paper.pages.length, figures: paper.figures.map(({ id, label }) => ({ id, label })), claims: paper.claims.map(({ id, text }) => ({ id, text })) };
  if (name === 'paper.get_page') {
    const page = paper.pages.find(page => page.pageNumber === (parsed as { pageNumber: number }).pageNumber);
    if (!page) throw new Error('论文页码不存在'); return page;
  }
  if (name === 'paper.get_figure') {
    const figure = paper.figures.find(figure => figure.id === (parsed as { figureId: string }).figureId);
    if (!figure) throw new Error('Figure 不存在');
    return { figure, sources: paper.sources.filter(source => [figure.sourceId, ...figure.panels.map(panel => panel.sourceId)].includes(source.id)) };
  }
  if (name === 'paper.get_claim') {
    const claim = paper.claims.find(claim => claim.id === (parsed as { claimId: string }).claimId);
    if (!claim) throw new Error('Claim 不存在');
    const evidences = paper.evidences.filter(evidence => claim.evidenceIds.includes(evidence.id));
    return { claim, evidences, sources: paper.sources.filter(source => evidences.some(evidence => evidence.sourceIds.includes(source.id))) };
  }
  const ids = (parsed as { slideIds?: string[] }).slideIds;
  if (ids?.some(id => !deck.slides.some(slide => slide.id === id))) throw new Error('幻灯片不存在');
  return { id: deck.id, revision: deck.revision, title: deck.title, language: deck.language, slides: ids ? deck.slides.filter(slide => ids.includes(slide.id)) : deck.slides.map(({ id, title, kind }, index) => ({ id, title, kind, pageNumber: index + 1 })) };
}
function revisionToolSchema(target: AiTarget) {
  const slideIds = !target.global && !target.allowNewSlides && target.slideIds.length
    ? z.array(z.enum(target.slideIds as [string, ...string[]])).min(1)
    : RevisionScopeSchema.options[1].shape.slideIds;
  const slides = RevisionScopeSchema.options[1].extend({ slideIds }).describe('页面属性（含标题、布局）、批量或新增删除页面使用此范围；包含所有受影响原页和本批新页。');
  const scope = target.elementId
    ? z.union([slides, RevisionScopeSchema.options[0].extend({ slideId: z.literal(target.slideIds[0]), elementId: z.literal(target.elementId) }).describe('仅替换或删除已绑定元素；修改页面标题或布局不能使用此范围。')])
    : target.global && !target.titleOnly && !target.figureId ? z.union([slides, RevisionScopeSchema.options[2]]) : slides;
  const mutations = target.titleOnly
    ? z.array(DeckMutationSchema.options[3].extend({ changes: DeckMutationSchema.options[3].shape.changes.pick({ title: true }).required() })).min(1)
    : ApplyRevisionArgsSchema.shape.mutations;
  return ApplyRevisionArgsSchema.extend({ scope, mutations });
}
export async function validateAiCandidate(raw: unknown, target: AiTarget, deck: Deck, paper: Paper) {
  const args = ApplyRevisionArgsSchema.parse(raw);
  if (args.scope.type === 'element' && !target.elementId) throw new Error('标题或页面修改必须使用包含目标页的 slides 范围');
  const newIds = args.mutations.flatMap(mutation => mutation.type === 'add-slide' ? [mutation.slide.id] : []);
  const allowed = new Set([...target.slideIds, ...newIds]);
  if (!target.global) {
    if (args.scope.type === 'deck' || (args.scope.type === 'slides' ? args.scope.slideIds : [args.scope.slideId]).some(id => !allowed.has(id))) throw new Error('修改超出本次请求绑定的页面范围');
    for (const mutation of args.mutations) {
      if (mutation.type === 'set-language') throw new Error('局部请求不能修改整套语言');
      if (mutation.type === 'add-slide') {
        if (!target.allowNewSlides || (mutation.afterSlideId === null ? !!deck.slides.length && !target.slideIds.includes(deck.slides[0].id) : !allowed.has(mutation.afterSlideId))) throw new Error('新增页面超出请求范围');
        continue;
      }
      if (!allowed.has(mutation.slideId)) throw new Error('修改超出本次请求绑定的页面范围');
    }
  }
  for (const mutation of args.mutations) {
      if (target.titleOnly && (mutation.type !== 'update-slide' || Object.keys(mutation.changes).some(key => key !== 'title'))) throw new Error('标题请求只能修改目标标题');
      if (target.elementId) {
        if (mutation.type === 'set-language' || mutation.type === 'add-slide') throw new Error('修改超出本次请求绑定的元素范围');
        const id = mutation.type === 'replace-element' ? mutation.element.id : mutation.type === 'delete-element' ? mutation.elementId : undefined;
        const layoutOnly = mutation.type === 'update-slide' && Object.keys(mutation.changes).every(key => key === 'layoutId');
        if (id !== target.elementId && !layoutOnly) throw new Error('修改超出本次请求绑定的元素范围');
      }
      if (target.figureId) {
        if (mutation.type === 'set-language' || mutation.type === 'add-slide') throw new Error('Figure 请求不能改写其他内容');
        const previous = deck.slides.find(slide => slide.id === mutation.slideId);
        const element = mutation.type === 'delete-element' ? previous?.elements.find(element => element.id === mutation.elementId) : mutation.type === 'replace-element' || mutation.type === 'add-element' ? mutation.element : undefined;
        const layoutOnly = mutation.type === 'update-slide' && Object.keys(mutation.changes).every(key => key === 'layoutId');
        const replaced = mutation.type === 'replace-element' ? previous?.elements.find(element => element.id === mutation.element.id) : undefined;
        if (!layoutOnly && (element?.type !== 'figure' || element.figureId !== target.figureId || (replaced && (replaced.type !== 'figure' || replaced.figureId !== target.figureId)))) throw new Error('Figure 请求不能改写其他内容');
      }
  }
  // 使用现有提交与布局校验，在独立内存会话中验证完整批次；不产生存储写入。
  const working = new DeckSession(deck, paper);
  await working.commit(args.scope, args.mutations, args.summary);
  const affectedSlideIds = [...new Set(args.mutations.flatMap(mutation => mutation.type === 'set-language' ? deck.slides.map(slide => slide.id) : mutation.type === 'add-slide' ? [mutation.slide.id] : [mutation.slideId]))];
  return { args, affectedSlideIds };
}

export async function runAiRevision({ settings, paper, deck: inputDeck, session, request, selectedSlideId, selectedElementId, recentMessages = [], signal, projectId = '', requestId = crypto.randomUUID(), isTaskActive, preferences }: {
  settings: ModelSettings; paper: Paper; deck: Deck; session: DeckSession; request: string; selectedSlideId?: string; selectedElementId?: string; recentMessages?: AiRecentMessage[]; signal: AbortSignal; projectId?: string; requestId?: string; isTaskActive?: () => boolean; preferences?: Project['preferences'];
}) {
  const deck = structuredClone(inputDeck); const baseRevision = deck.revision;
  const assertActive = () => { signal.throwIfAborted(); if (isTaskActive && !isTaskActive()) throw new Error('修改请求已失效'); if (session.current.id !== deck.id || session.current.revision !== baseRevision) throw new Error('当前幻灯片已变化，请基于最新内容重试。'); };
  assertActive();
  const history = recentMessages.filter(message => !message.deckId || message.deckId === deck.id).slice(-6);
  const target = resolveAiTarget(request, deck, paper, selectedSlideId, selectedElementId, history);
  const createMessages = (answer: string, revision?: { summary: string; affectedSlideIds: string[] }): ChatMessage[] => {
    const common = { projectId, deckId: deck.id, baseRevision, targetSlideIds: target.slideIds, ...(target.elementId ? { targetElementId: target.elementId } : {}), createdAt: Date.now() };
    return [{ ...common, id: requestId + '-user', role: 'user', text: request }, { ...common, id: requestId + '-assistant', createdAt: common.createdAt + 1, role: 'assistant', text: answer, ...(revision ? { ...revision, revision: baseRevision + 1 } : {}) }];
  };
  const answerResult = async (answer: string) => {
    assertActive(); const messages = createMessages(answer);
    if (projectId) await saveConversation(projectId, messages, signal, isTaskActive);
    return { output: { mode: 'answer' as const, answer }, committed: false as const, messages, affectedSlideIds: [] as string[] };
  };
  if (target.clarification) return answerResult(target.clarification);
  const data = { request, layoutRules, selectedSlideId, selectedElementId, boundTarget: { ...target, allowedScopeTypes: target.elementId ? ['slides', 'element'] : target.global && !target.titleOnly && !target.figureId ? ['slides', 'deck'] : ['slides'] }, recentMessages: history, preferences, ...localContext(paper, deck, target) };
  const prompt = [prompts.common, prompts.stages.ai].join('\n\n');
  // 分类调用没有写工具；请求只读时，后续工具回合也不会提供写工具。
  const intent = await requestJson(settings, prompt + '\n当前步骤只识别意图：问题、解释、检查或审核选择 answer；要求实际调整（含“太挤”“短一点”“按刚才建议修改”）选择 revision；只有研究叙事、内容取舍或结构调整需要 needsStrategy。此步骤不执行修改。', data, AiIntentSchema, signal, 'ai');
  assertActive();
  if (/不要(?:做任何)?修改|不(?:要|用|需)改|只(?:需|要)?(?:解释|回答|检查|审核|建议)|仅(?:解释|回答|检查|审核)|do not (?:edit|change|modify)/i.test(modificationRequest(request))) intent.mode = 'answer';
  const strategy = intent.needsStrategy ? researchPrompt(preferences?.strategyId) : undefined;
  const readTools = Object.entries(readSchemas).map(([name, schema]) => tool(name, descriptions[name as keyof typeof readSchemas], schema));
  const context: Context = {
    systemPrompt: [prompt, strategy?.strategy.body, intent.mode === 'revision' ? '本轮允许按 boundTarget 修改；需要修改时仅调用一次 deck.apply_revision。update-slide（包括标题与布局）必须使用 slides 范围；element 范围只用于替换或删除已绑定元素。工具只暂存候选，随后正常结束并用简短文字交代结果。' : '本轮为问答/审核，只有读取权限；直接用文字回答或给出建议。'].filter(Boolean).join('\n\n'),
    tools: [...readTools, ...(intent.mode === 'revision' ? [tool('deck.apply_revision', '暂存一批原子修改；一次请求仅可调用一次，正常结束后才保存，scope 不能扩大 boundTarget。', revisionToolSchema(target))] : [])],
    messages: [{ role: 'user', content: JSON.stringify({ ...data, ...(strategy?.fallback ? { strategyWarning: '已保存策略不存在，本轮使用 general；不修改项目默认策略。' } : {}) }), timestamp: Date.now() }],
  };
  let candidate: Awaited<ReturnType<typeof validateAiCandidate>> | undefined;
  for (let turn = 0; turn < 10; turn++) {
    assertActive();
    const response = await requestModel(settings, context, signal, 'ai');
    assertActive(); context.messages.push(response);
    const calls = response.content.filter(block => block.type === 'toolCall');
    if (calls.length) {
      if (response.stopReason !== 'toolUse') throw new Error('工具回合未完整结束，本次修改未保存');
      for (const call of calls) {
        assertActive(); let result: unknown;
        if (call.name === 'deck.apply_revision') {
          if (intent.mode !== 'revision' || candidate) throw new Error('本次请求不允许写入或重复提交修改候选');
          candidate = await validateAiCandidate(call.arguments, target, deck, paper);
          result = { staged: true, summary: candidate.args.summary, affectedSlideIds: candidate.affectedSlideIds };
        } else if (Object.hasOwn(readSchemas, call.name)) result = readTool(call.name as keyof typeof readSchemas, call.arguments, paper, deck);
        else throw new Error('模型请求了未开放的工具，本次修改未保存');
        context.messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: JSON.stringify(result) }], isError: false, timestamp: Date.now() });
      }
      continue;
    }
    if (response.stopReason !== 'stop') throw new Error('模型回合未正常结束，本次修改未保存');
    const answer = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim();
    if (!candidate) {
      if (!answer) throw new Error('模型未返回回答，请重试');
      return answerResult(intent.mode === 'revision' ? answer + '\n\n本轮未更改幻灯片。' : answer);
    }
    assertActive();
    const text = answer || '已完成修改。'; const messages = createMessages(text, { summary: candidate.args.summary, affectedSlideIds: candidate.affectedSlideIds });
    const committed = await session.applyRevision({ requestId, projectId, deckId: deck.id, baseRevision }, candidate.args, { signal, isTaskActive, messages });
    return { output: { mode: 'revision' as const, answer: text, ...candidate.args }, committed: true as const, deck: committed, messages, affectedSlideIds: candidate.affectedSlideIds };
  }
  throw new Error('本次请求读取次数过多，尚未保存修改，请缩小问题范围后重试。');
}
