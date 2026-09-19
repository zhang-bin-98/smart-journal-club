import { ModelError } from '../../app/llm/modelError';

type Limits = { concurrency: number; requests: number; tokens: number; windowMs: number; queue: number };
type Job = {
  priority: 'interactive' | 'background';
  tokens: number;
  signal: AbortSignal;
  start: () => void;
  cancel: () => void;
  reservation?: { at: number; tokens: number };
};
export type SchedulerState = { running: number; queued: number; waitingUntil: number };
export class TemporaryRateLimit extends ModelError {
  constructor(
    stage: string,
    readonly retryAfterMs?: number,
  ) {
    super(stage, 'rate-limit', '模型请求暂时受到限流，请稍后重试。');
  }
}

/** 一个组合根共享保守限额桶；模型切换不重置额度，状态中不保存凭据或正文。 */
export class RequestScheduler {
  private queue: Job[] = [];
  private running = 0;
  private oversizedRunning = false;
  private reservations: { at: number; tokens: number }[] = [];
  private blockedUntil = 0;
  private interactiveStreak = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private state: SchedulerState = { running: 0, queued: 0, waitingUntil: 0 };
  constructor(
    private readonly limits: Limits = { concurrency: 2, requests: 30, tokens: 120000, windowMs: 60000, queue: 64 },
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(waitingUntil = 0) {
    this.state = { running: this.running, queued: this.queue.length, waitingUntil };
    for (const listener of this.listeners) listener();
  }

  /** 可读的供应商额度只收紧本地估算；CORS 未暴露时继续采用保守窗口。 */
  observe(headers: Headers) {
    const now = Date.now();
    for (const kind of ['requests', 'tokens']) {
      const remaining = headers.get(`x-ratelimit-remaining-${kind}`);
      const reset = headers.get(`x-ratelimit-reset-${kind}`);
      if (remaining !== null && Number(remaining) === 0 && reset) {
        const ms = durationMs(reset);
        if (ms !== undefined) this.blockedUntil = Math.max(this.blockedUntil, now + ms);
      }
    }
  }

  async run<T>({
    signal,
    tokens,
    priority,
    stage,
    execute,
    actualTokens,
  }: {
    signal: AbortSignal;
    tokens: number;
    priority: Job['priority'];
    stage: string;
    execute: () => Promise<T>;
    actualTokens?: (result: T) => number;
  }): Promise<T> {
    let backoff = 0;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const release = await this.acquire({ signal, tokens, priority, stage });
      let consumed: number | undefined;
      try {
        signal.throwIfAborted();
        const result = await execute();
        consumed = actualTokens?.(result);
        signal.throwIfAborted();
        return result;
      } catch (cause) {
        signal.throwIfAborted();
        if (!(cause instanceof TemporaryRateLimit) || attempt >= 2) throw cause;
        const delay = cause.retryAfterMs ?? Math.round(1000 * 2 ** attempt * (1 + Math.random()));
        if (backoff + delay > 120000) throw cause;
        backoff += delay;
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
      } finally {
        release(consumed);
      }
    }
  }

  private acquire({
    signal,
    tokens,
    priority,
    stage,
  }: {
    signal: AbortSignal;
    tokens: number;
    priority: Job['priority'];
    stage: string;
  }): Promise<(actual?: number) => void> {
    signal.throwIfAborted();
    if (!Number.isFinite(tokens) || tokens <= 0)
      return Promise.reject(new ModelError(stage, 'token-budget', '单次请求超过当前 Token 预算，请减少输入后重试。'));
    if (this.queue.length >= this.limits.queue)
      return Promise.reject(new ModelError(stage, 'queue-full', '请求队列已满，请等待当前任务完成。'));
    return new Promise((resolve, reject) => {
      const job: Job = {
        signal,
        tokens,
        priority,
        start: () => {
          signal.removeEventListener('abort', job.cancel);
          let released = false;
          resolve((actual) => {
            if (released) return;
            released = true;
            if (job.reservation && actual !== undefined && Number.isFinite(actual) && actual > 0)
              job.reservation.tokens = Math.ceil(actual);
            this.running--;
            if (tokens > this.limits.tokens) this.oversizedRunning = false;
            this.pump();
          });
        },
        cancel: () => {
          this.queue = this.queue.filter((item) => item !== job);
          reject(signal.reason);
          this.pump();
        },
      };
      signal.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    clearTimeout(this.timer);
    const now = Date.now();
    this.reservations = this.reservations.filter((entry) => entry.at + this.limits.windowMs > now);
    let waitingUntil = 0;
    while (this.queue.length && this.running < this.limits.concurrency) {
      const background = this.queue.findIndex((job) => job.priority === 'background');
      const interactive = this.queue.findIndex((job) => job.priority === 'interactive');
      const index =
        background >= 0 && (this.interactiveStreak >= 2 || interactive < 0) ? background : Math.max(0, interactive);
      const job = this.queue[index];
      const oversized = job.tokens > this.limits.tokens;
      // 本地速率桶不是模型容量；大请求只在空窗口独占发送，不能因预留输出较大而永久拒绝。
      if (this.oversizedRunning || (oversized && this.running > 0)) break;
      const used = this.reservations.reduce((sum, entry) => sum + entry.tokens, 0);
      if (this.blockedUntil > now) waitingUntil = this.blockedUntil;
      if (
        this.reservations.length >= this.limits.requests ||
        (this.reservations.length > 0 && (oversized || used + job.tokens > this.limits.tokens))
      )
        waitingUntil = Math.max(waitingUntil, this.reservations[0].at + this.limits.windowMs);
      if (waitingUntil > now) {
        this.timer = setTimeout(() => this.pump(), Math.min(waitingUntil - now, 2147483647));
        break;
      }
      this.queue.splice(index, 1);
      this.interactiveStreak = job.priority === 'interactive' ? this.interactiveStreak + 1 : 0;
      this.running++;
      this.oversizedRunning = oversized;
      job.reservation = { at: now, tokens: job.tokens };
      this.reservations.push(job.reservation);
      job.start();
    }
    this.publish(waitingUntil);
  }
}

export function durationMs(value: string): number | undefined {
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return undefined;
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
    (sum, match) => sum + Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]] ?? 0),
    0,
  );
}

export function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
