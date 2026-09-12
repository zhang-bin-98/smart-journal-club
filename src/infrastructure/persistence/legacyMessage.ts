// 可见对话与修改记录共用 history store；不保存工具消息、Key 或撤销快照。
export type ChatMessage = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  deckId: string;
  baseRevision: number;
  revision?: number;
  summary?: string;
  affectedSlideIds?: string[];
  targetSlideIds?: string[];
  targetElementId?: string;
};
