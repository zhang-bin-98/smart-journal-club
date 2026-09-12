import { z } from 'zod';
import { ApplyRevisionArgsSchema, type Deck, type ApplyRevisionArgs } from '../../modules/deck/deck.schema';
import { DeckSession } from '../presentation/DeckSession';
import type { Paper } from '../../modules/paper/model';
import type { ReadAgent } from '../paper/paperAssistant';
import type { ModelSettings } from '../settings/modelSettings';
import { ContentError } from '../../modules/presentation/content';
import { beginActivity } from '../activity';
export type SlidesProposal = {
  capture: ReturnType<DeckSession['capture']>;
  args: ApplyRevisionArgs;
  preview: Deck;
  slideIds: string[];
};
/** Selection is expanded only when sending. The actual session repeats scope, draft and revision checks on apply. */
export function createSlidesAssistant(run: ReadAgent) {
  return async (input: {
    session: DeckSession;
    paper: Paper;
    settings: ModelSettings;
    question: string;
    mode: 'ask' | 'edit';
    slideIds?: string[];
    signal: AbortSignal;
    onText: (text: string) => void;
  }) => {
    const done = beginActivity();
    try {
      const capture = input.session.capture();
      const deck = structuredClone(input.session.current);
      const ids = input.slideIds ?? deck.slides.map((s) => s.id);
      if (ids.some((id) => !deck.slides.some((s) => s.id === id)) || (!ids.length && input.slideIds))
        throw new ContentError('missing-scope', '发送时所选页面不存在。');
      const allowed = new Set(ids);
      let proposal: SlidesProposal | undefined;
      const answer = await run({
        settings: input.settings,
        signal: input.signal,
        onText: input.onText,
        prompt:
          '你是科研幻灯片助手。只按发送时页面范围回答或提出修改，禁止扩大范围。讲稿正文唯一，分页与讲稿分配必须同批维护。修改先形成候选，绝不直接写稿。页面图源只选择论文已有来源；普通措辞不能改变科学强度。用户请求：' +
          input.question,
        context: {
          slides: deck.slides.filter((s) => allowed.has(s.id)),
          sections: deck.sections,
          speech: deck.speech?.filter((s) =>
            deck.slides.some((slide) => allowed.has(slide.id) && slide.speechIds?.includes(s.id)),
          ),
          paper: {
            metadata: input.paper.metadata,
            figures: input.paper.figures,
            sources: input.paper.sources,
            claims: input.paper.claims,
          },
        },
        tools:
          input.mode === 'edit'
            ? [
                {
                  name: 'propose_slide_changes',
                  label: '预览幻灯片修改',
                  description: '提出当前页面能力允许的批量修改，保留讲稿和引用合法性；此工具不写入。',
                  parameters: z.toJSONSchema(ApplyRevisionArgsSchema),
                  execute(raw) {
                    input.signal.throwIfAborted();
                    input.session.assertCapture(capture);
                    const args = ApplyRevisionArgsSchema.parse(raw);
                    if (input.slideIds) {
                      if (args.scope.type === 'deck')
                        throw new ContentError('outside-scope', '不能把局部修改扩大到整稿。');
                      const newIds = args.mutations.flatMap((m) => (m.type === 'add-slide' ? [m.slide.id] : []));
                      const scopeIds = args.scope.type === 'slides' ? args.scope.slideIds : [args.scope.slideId];
                      if (scopeIds.some((id) => !allowed.has(id) && !newIds.includes(id)))
                        throw new ContentError('outside-scope', '修改超出发送时范围。');
                      const allowedSpeech = new Set(
                        deck.slides.filter((s) => allowed.has(s.id)).flatMap((s) => s.speechIds ?? []),
                      );
                      for (const mutation of args.mutations)
                        if (mutation.type === 'split-speech' && allowedSpeech.has(mutation.segmentId))
                          allowedSpeech.add(mutation.newId);
                      for (const mutation of args.mutations) {
                        if (mutation.type === 'add-slide' || mutation.type === 'move-slide') {
                          const anchor = mutation.afterSlideId;
                          if (
                            anchor === null
                              ? !allowed.has(deck.slides[0]?.id)
                              : !allowed.has(anchor) && !newIds.includes(anchor)
                          )
                            throw new ContentError('outside-scope', '插入位置超出授权页。');
                        }
                        const assigned =
                          mutation.type === 'update-slide'
                            ? mutation.changes.speechIds
                            : mutation.type === 'add-slide'
                              ? mutation.slide.speechIds
                              : undefined;
                        if (assigned?.some((id) => !allowedSpeech.has(id)))
                          throw new ContentError('outside-scope', '不能分配授权页之外的讲稿。');
                        if (mutation.type === 'set-language')
                          throw new ContentError('outside-scope', '局部请求不能修改整稿语言。');
                        if (
                          'segmentId' in mutation &&
                          !deck.slides.some((s) => allowed.has(s.id) && s.speechIds?.includes(mutation.segmentId))
                        )
                          throw new ContentError('outside-scope', '讲稿不属于授权页。');
                      }
                    }
                    // Preview uses the same Session validation, but no persistence adapter.
                    proposal = { capture, args, preview: deck, slideIds: ids };
                    return { status: 'proposal-recorded', summary: args.summary };
                  },
                },
              ]
            : [],
      });
      input.signal.throwIfAborted();
      input.session.assertCapture(capture);
      if (proposal) {
        const validated = proposal as SlidesProposal;
        const preview = new DeckSession(deck, input.paper);
        await preview.commit(validated.args.scope, validated.args.mutations, validated.args.summary);
        validated.preview = preview.current;
      }
      return { answer, proposal };
    } finally {
      done();
    }
  };
}
