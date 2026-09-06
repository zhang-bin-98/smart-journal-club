import type { ChatMessage } from '../../modules/assistant/assistant.schema';
import type { Deck, RevisionRecord } from '../../modules/deck/deck.schema';
import { request } from './indexedDb';

// history store 同时保存 assistant 可见对话与 deck 修订记录；裁剪与写入校验是共享的持久化契约。
export type HistoryEntry = RevisionRecord | ChatMessage;
export function isMessage(item: HistoryEntry): item is ChatMessage { return 'role' in item; }
export function assertMessage(message: ChatMessage, projectId: string, deck: Deck) {
  if (!message.id || message.projectId !== projectId || message.deckId !== deck.id || message.baseRevision !== deck.revision || !['user', 'assistant'].includes(message.role) || !message.text.trim() || !Number.isFinite(message.createdAt)) throw new Error('对话目标或内容无效');
}
export async function trimHistory(tx: IDBTransaction, projectId: string) {
  const history = (await request(tx.objectStore('history').getAll()) as HistoryEntry[]).filter(item => item.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  // 请求标识单独保留，避免普通对话挤掉最近的修改去重记录。
  for (const items of [history.filter(isMessage), history.filter((item) => !isMessage(item))]) items.slice(100).forEach((item) => { tx.objectStore('history').delete(item.id); });
}
