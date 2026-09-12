import { DeckSession } from './DeckSession';
import { generatePresentation } from '../workflows/generatePresentation';
import { exportPresentation } from './exportPresentation';
import type { SlidesStore, SlidesWorkspace } from './slidesPorts';
import type { PromptCatalog } from '../llm/promptCatalog';
import type { createModelRequests } from '../llm/requests';
/** 四步工作台共享应用提交入口；资源与下载能力由装配层提供。 */
export function createSlidesService<Resources>(dependencies: {
  store: SlidesStore;
  requests: ReturnType<typeof createModelRequests>;
  prompts: PromptCatalog;
  resources: (state: SlidesWorkspace) => Resources;
  export: Parameters<typeof exportPresentation>[0]['export'];
  download: Parameters<typeof exportPresentation>[0]['download'];
}) {
  return {
    open: dependencies.store.open,
    candidate: dependencies.store.candidate,
    restore: dependencies.store.restore,
    rememberSlide: dependencies.store.rememberSlide,
    session: (state: Awaited<ReturnType<typeof dependencies.store.open>>) =>
      state.current
        ? new DeckSession(state.current, state.paper, dependencies.store.revision(state.project.id), state.project.id)
        : undefined,
    resources: (state: Awaited<ReturnType<typeof dependencies.store.open>>) => dependencies.resources(state),
    generate: (input: Omit<Parameters<typeof generatePresentation>[0], 'store' | 'requests' | 'prompts'>) =>
      generatePresentation({
        ...input,
        prompts: dependencies.prompts,
        store: dependencies.store,
        requests: dependencies.requests,
      }),
    export: (input: Omit<Parameters<typeof exportPresentation>[0], 'store' | 'export' | 'download'>) =>
      exportPresentation({
        ...input,
        store: dependencies.store,
        export: dependencies.export,
        download: dependencies.download,
      }),
  };
}
