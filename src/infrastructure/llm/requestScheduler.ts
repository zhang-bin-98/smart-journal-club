import { ModelError } from '../../app/llm/modelError';

type Limits = { concurrency: number; queue: number };
type Job = {
  priority: 'interactive' | 'background';
  signal: AbortSignal;
  start: () => void;
  cancel: () => void;
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

/** 共享并发额度；只有真实服务限流才等待，不根据输出预留推断 Token 速率。 */
export class RequestScheduler {
  private queue: Job[] = [];
  private running = 0;
  private admissions = new Set<() => void>();
  private blockedUntil = 0;
  private interactiveStreak = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private state: SchedulerState = { running: 0, queued: 0, waitingUntil: 0 };
  constructor(private readonly limits: Limits = { concurrency: 5, queue: 64 }) {}
  configure(concurrency: number) {
    this.limits.concurrency = concurrency;
    this.pump();
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(waitingUntil = 0) {
    this.state = { running: this.running, queued: this.queue.length + this.admissions.size, waitingUntil };
    for (const listener of this.listeners) listener();
  }

  /** 仅遵循服务明确暴露的耗尽与重置头；未暴露时不猜测限额。 */
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
    priority,
    execute,
  }: {
    signal: AbortSignal;
    priority: Job['priority'];
    stage: string;
    execute: () => Promise<T>;
  }): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const release = await this.acquire({ signal, priority });
      try {
        signal.throwIfAborted();
        const result = await execute();
        signal.throwIfAborted();
        return result;
      } catch (cause) {
        signal.throwIfAborted();
        if (!(cause instanceof TemporaryRateLimit) || attempt >= 2) throw cause;
        const delay = cause.retryAfterMs ?? Math.round(1000 * 2 ** attempt * (1 + Math.random()));
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
      } finally {
        release();
      }
    }
  }

  private async acquire({ signal, priority }: { signal: AbortSignal; priority: Job['priority'] }): Promise<() => void> {
    signal.throwIfAborted();
    while (this.queue.length >= this.limits.queue) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          this.admissions.delete(wake);
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          this.admissions.delete(wake);
          reject(signal.reason);
          this.publish(this.state.waitingUntil);
        };
        this.admissions.add(wake);
        signal.addEventListener('abort', cancel, { once: true });
        this.publish(this.state.waitingUntil);
      });
      signal.throwIfAborted();
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        signal,
        priority,
        start: () => {
          signal.removeEventListener('abort', job.cancel);
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.running--;
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
    let waitingUntil = 0;
    while (this.queue.length && this.running < this.limits.concurrency) {
      const background = this.queue.findIndex((job) => job.priority === 'background');
      const interactive = this.queue.findIndex((job) => job.priority === 'interactive');
      const index =
        background >= 0 && (this.interactiveStreak >= 2 || interactive < 0) ? background : Math.max(0, interactive);
      const job = this.queue[index];
      if (this.blockedUntil > now) waitingUntil = this.blockedUntil;
      if (waitingUntil > now) {
        this.timer = setTimeout(() => this.pump(), Math.min(waitingUntil - now, 2147483647));
        break;
      }
      this.queue.splice(index, 1);
      this.interactiveStreak = job.priority === 'interactive' ? this.interactiveStreak + 1 : 0;
      this.running++;
      job.start();
    }
    if (this.queue.length < this.limits.queue) for (const wake of [...this.admissions]) wake();
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
