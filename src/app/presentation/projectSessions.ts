import type { SpeechController } from './speechController';
import type { SlidesController } from './slidesController';
import { ContentError } from '../../modules/presentation/content';

type Guards = { beforeEdit: () => void; assertAvailable: () => void };
type Entry = {
  id: string;
  views: number;
  closing: boolean;
  speech?: SpeechController;
  slides?: SlidesController;
  subscriptions: (() => void)[];
};
/** 切换项目内视图不释放会话；离开项目清空局部候选，已授权生成完成后释放无人查看的资源。 */
export function createPresentationSessions(factories: {
  speech: (id: string, guards: Guards) => SpeechController;
  slides: (id: string, guards: Guards) => SlidesController;
}) {
  const entries = new Map<string, Entry>();
  function entry(id: string) {
    let value = entries.get(id);
    if (!value) {
      value = { id, views: 0, closing: false, subscriptions: [] };
      entries.set(id, value);
    }
    return value;
  }
  function dispose(value: Entry) {
    entries.delete(value.id);
    for (const unsubscribe of value.subscriptions) unsubscribe();
    value.speech?.dispose();
    value.slides?.dispose();
  }
  function release(value: Entry) {
    if (entries.get(value.id) !== value || value.views || value.closing) return;
    if (value.speech?.snapshot().running || value.slides?.snapshot().running) return;
    dispose(value);
  }
  function guards(value: Entry): Guards {
    return {
      beforeEdit() {
        value.speech?.stop();
        value.slides?.stop();
      },
      assertAvailable() {
        if (value.speech?.snapshot().running || value.slides?.snapshot().running)
          throw new ContentError('busy', '项目的生成或导出仍在运行，请等待完成或先暂停。');
        if (value.speech?.session.snapshot().dirty || value.slides?.snapshot().session?.dirty)
          throw new ContentError('dirty-target', '请先保存当前输入。');
      },
    };
  }
  function watch(value: Entry, controller: SpeechController | SlidesController) {
    value.subscriptions.push(controller.subscribe(() => queueMicrotask(() => release(value))));
  }
  return {
    attach(id: string) {
      const value = entry(id);
      value.views++;
      return () => {
        value.views--;
        queueMicrotask(() => {
          if (value.views || entries.get(id) !== value) return;
          value.closing = true;
          value.speech?.clearLocal();
          value.slides?.clearLocal();
          value.closing = false;
          release(value);
        });
      };
    },
    speech(id: string) {
      const value = entry(id);
      if (!value.speech) {
        value.speech = factories.speech(id, guards(value));
        watch(value, value.speech);
      }
      return value.speech;
    },
    slides(id: string) {
      const value = entry(id);
      if (!value.slides) {
        value.slides = factories.slides(id, guards(value));
        watch(value, value.slides);
      }
      return value.slides;
    },
    remove(id: string) {
      const value = entries.get(id);
      if (value) dispose(value);
    },
  };
}
