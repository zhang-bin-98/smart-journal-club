import { get, request, stored, transaction } from '../../shared/persistence/indexedDb';
import { assertMessage, isMessage, trimHistory, type HistoryEntry } from '../../shared/persistence/historyStore';
import type { ChatMessage } from './assistant.schema';
import { DeckSchema } from '../deck/deck.schema';
import { projectIn } from '../project/projectRepository';

export function loadHistory(projectId: string): Promise<ChatMessage[]> {
  return transaction(['projects', 'history'], 'readonly', async (tx) => {
    await projectIn(tx, projectId);
    return ((await request(tx.objectStore('history').getAll())) as HistoryEntry[])
      .filter(isMessage)
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-100);
  });
}
export function saveConversation(
  projectId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  isTaskActive?: () => boolean,
) {
  return transaction(
    ['projects', 'decks', 'history'],
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, projectId);
      const deck = project.currentDeckId
        ? stored(DeckSchema, await get(tx, 'decks', project.currentDeckId), '当前幻灯片')
        : undefined;
      if (!deck) throw new Error('当前文稿已变化，请重新打开项目');
      for (const message of messages) {
        assertMessage(message, projectId, deck);
        if (message.revision !== undefined) throw new Error('修改摘要必须随修改一起保存');
      }
      signal?.throwIfAborted();
      if (isTaskActive && !isTaskActive()) throw new Error('对话请求已失效');
      for (const message of messages) tx.objectStore('history').add(message, message.id);
      await trimHistory(tx, projectId);
      signal?.throwIfAborted();
      if (isTaskActive && !isTaskActive()) throw new Error('对话请求已失效');
    },
    signal,
  );
}
