import type { createAnalysisService } from '../paper/analysisService';
import type { ModelSettings } from '../settings/modelSettings';
import { ContentError } from '../../modules/presentation/content';
/** 用户已启动本步时自动补完图源修改影响的证据，取消沿用同一分析任务权限。 */
export function createSpeechEvidenceRefresh(service: ReturnType<typeof createAnalysisService>) {
  return async (projectId: string, settings: ModelSettings, signal: AbortSignal) => {
    const session = service.session(projectId);
    signal.throwIfAborted();
    await session.load();
    const abort = () => session.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await session.start(settings);
      signal.throwIfAborted();
      if (session.snapshot().status !== 'completed')
        throw new ContentError('evidence-incomplete', '必要证据关联未完成，已保存讲稿保留，请重试。');
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
}
