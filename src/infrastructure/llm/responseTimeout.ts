import type { ModelSettings } from '../../app/settings/modelSettings';

/** 计时从派发开始；接收字节（包括服务心跳）刷新停滞计时，不暴露思考内容。 */
export function responseTimeout(settings: ModelSettings) {
  const controller = new AbortController();
  let deadline = Date.now() + settings.firstResponseTimeoutSeconds * 1000;
  const totalDeadline =
    settings.totalTimeoutSeconds === null ? Infinity : Date.now() + settings.totalTimeoutSeconds * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = () => {
    clearTimeout(timer);
    if (disposed || controller.signal.aborted) return;
    const remaining = Math.min(deadline, totalDeadline) - Date.now();
    if (remaining <= 0) controller.abort();
    else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
  };
  const activity = () => {
    deadline = Date.now() + settings.idleTimeoutSeconds * 1000;
    schedule();
  };
  schedule();
  return {
    signal: controller.signal,
    activity,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
    watch(response: Response) {
      activity();
      if (!response.body) return response;
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const next = await reader.read();
            if (next.done) output.close();
            else {
              activity();
              output.enqueue(next.value);
            }
          } catch (cause) {
            output.error(cause);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}
