/** 有界生产；失败后不领取新单元，等待已启动单元收尾，结果保持输入顺序。 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const results: R[] = [];
  const worker = async () => {
    while (cursor < items.length && !failed) {
      const index = cursor++;
      try {
        signal.throwIfAborted();
        results[index] = await work(items[index], index);
      } catch (cause) {
        failed = true;
        failure = cause;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, worker));
  if (failed) throw failure;
  signal.throwIfAborted();
  return results;
}
