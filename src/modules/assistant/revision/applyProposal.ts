import type { ApplyRevisionArgs, Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { DeckSession } from '../../deck/DeckSession';
import type { ChatMessage } from '../assistant.schema';
import type { AiTarget } from '../target/resolveTarget';
import { AssistantError } from '../assistantError';
import { validateAiCandidate } from './validateRevisionProposal';
import { applyAssistantRevision, type PersistAssistantRevision } from './applyRevision';

export interface PendingRevision extends ApplyRevisionArgs {
  requestId: string;
  projectId: string;
  deckId: string;
  baseRevision: number;
  affectedSlideIds: string[];
  createdAt: number;
  target: AiTarget;
  messages: ChatMessage[];
  preview: Deck;
}
/** 应用前重新验证绑定版本与范围，只有此命令能将待审提案写入会话。 */
export async function applyProposal({
  proposal,
  session,
  paper,
  signal,
  isTaskActive,
  persistRevision,
}: {
  proposal: PendingRevision;
  session: DeckSession;
  paper: Paper;
  signal: AbortSignal;
  isTaskActive: () => boolean;
  persistRevision?: PersistAssistantRevision;
}) {
  signal.throwIfAborted();
  if (!isTaskActive() || session.current.id !== proposal.deckId || session.current.revision !== proposal.baseRevision)
    throw new AssistantError('stale-proposal', '提案已失效，请基于当前文稿重新发起修改。');
  const args = { scope: proposal.scope, mutations: proposal.mutations, summary: proposal.summary };
  await validateAiCandidate(args, proposal.target, session.current, paper);
  signal.throwIfAborted();
  const messages = proposal.messages.map((message) =>
    message.role === 'assistant'
      ? {
          ...message,
          text: '已应用修改。',
          summary: proposal.summary,
          affectedSlideIds: proposal.affectedSlideIds,
          revision: proposal.baseRevision + 1,
        }
      : message,
  );
  const deck = await applyAssistantRevision({
    session,
    request: proposal,
    args,
    messages,
    signal,
    isTaskActive,
    persistRevision,
  });
  return { deck, messages };
}
