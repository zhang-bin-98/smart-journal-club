/** 队列满时向调用方施加背压；等待可取消，腾出空间后重新检查容量。 */
export class QueueCapacity {
  private waiting = new Set<() => void>();
  async wait(signal: AbortSignal, isFull: () => boolean) {
    signal.throwIfAborted();
    while (isFull()) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          this.waiting.delete(wake);
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          this.waiting.delete(wake);
          reject(signal.reason);
        };
        this.waiting.add(wake);
        signal.addEventListener('abort', cancel, { once: true });
      });
      signal.throwIfAborted();
    }
  }
  notify() {
    for (const wake of [...this.waiting]) wake();
  }
}
