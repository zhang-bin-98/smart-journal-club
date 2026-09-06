import type { ApplyRevisionArgs, Deck, RevisionRecord, RevisionRequest } from '../../deck/deck.schema';
import type { DeckSession, PersistRevision, RevisionOptions } from '../../deck/DeckSession';
import type { ChatMessage } from '../assistant.schema';

/** 应用层原子提交：Deck 修订、修订记录与可见对话由同一 persist 调用在一次事务内写入。 */
export type PersistAssistantRevision = (
  previous: Deck,
  next: Deck,
  record: RevisionRecord,
  options?: RevisionOptions,
  messages?: ChatMessage[],
) => Promise<void>;
/** AI 修改的唯一提交入口：Deck 领域会话不再感知对话消息，跨领域组合由此命令完成。 */
export function applyAssistantRevision({
  session,
  request,
  args,
  messages,
  signal,
  isTaskActive,
  persistRevision,
}: {
  session: DeckSession;
  request: RevisionRequest;
  args: ApplyRevisionArgs;
  messages?: ChatMessage[];
  signal?: AbortSignal;
  isTaskActive?: () => boolean;
  persistRevision?: PersistAssistantRevision;
}) {
  const options: RevisionOptions & { persist?: PersistRevision } = persistRevision
    ? {
        signal,
        isTaskActive,
        persist: (previous, next, record, persistOptions) =>
          persistRevision(previous, next, record, persistOptions, messages),
      }
    : { signal, isTaskActive };
  return session.applyRevision(request, args, options);
}
