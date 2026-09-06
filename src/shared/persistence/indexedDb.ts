const DATABASE = 'smartjc';
export const stores = ['projects', 'papers', 'assets', 'plans', 'decks', 'history', 'settings'] as const;
export type Store = (typeof stores)[number];
export const request = <T>(operation: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('本地存储读取失败'));
  });
async function open() {
  const operation = indexedDB.open(DATABASE, 1);
  operation.onupgradeneeded = () => {
    for (const name of stores) operation.result.createObjectStore(name);
  };
  const db = await request(operation).catch((cause) => {
    if (cause instanceof DOMException && cause.name === 'VersionError')
      throw new Error('本地数据库版本与当前应用不兼容，请更新应用后重试；项目数据已保留。');
    throw cause;
  });
  db.onversionchange = () => db.close();
  return db;
}
export async function transaction<T>(
  names: Store[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const db = await open();
  const tx = db.transaction(names, mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存已取消，最近保存的成果仍保留'));
    tx.onerror = () => reject(tx.error ?? new Error('本地存储写入失败'));
  });
  void complete.catch(() => {});
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* 已完成的事务保持提交结果。 */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await work(tx);
    await complete;
    return result;
  } catch (cause) {
    abort();
    await complete.catch(() => {});
    if (cause instanceof DOMException && cause.name === 'QuotaExceededError')
      throw new Error('本地空间不足，成果未保存。请释放项目空间后重试，并保留当前页面。');
    throw cause;
  } finally {
    signal?.removeEventListener('abort', abort);
    db.close();
  }
}
export const get = <T>(tx: IDBTransaction, name: Store, key: string) =>
  request(tx.objectStore(name).get(key)) as Promise<T | undefined>;
// 仅对象结构版本检查：Deck/DeckPlan 已升 v2，v1 数据的迁移属 M9.2，未迁移前按不兼容拒绝。
export function stored<T>(schema: { parse(value: unknown): T }, value: unknown, label: string, version = 1): T {
  if (value === undefined) throw new Error(`${label}数据缺失，请保留项目并检查本地存储。`);
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== version)
    throw new Error(`${label}数据版本与当前应用不兼容，请更新应用后重试；项目数据已保留。`);
  return schema.parse(value);
}
