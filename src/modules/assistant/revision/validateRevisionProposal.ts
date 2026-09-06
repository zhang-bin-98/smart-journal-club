import { ApplyRevisionArgsSchema, type Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import { DeckSession } from '../../deck/DeckSession';
import type { AiTarget } from '../target/resolveTarget';

export async function validateAiCandidate(raw: unknown, target: AiTarget, deck: Deck, paper: Paper) {
  const args = ApplyRevisionArgsSchema.parse(raw);
  if (args.scope.type === 'element' && !target.elementId)
    throw new Error('标题或页面修改必须使用包含目标页的 slides 范围');
  const newIds = args.mutations.flatMap((mutation) => (mutation.type === 'add-slide' ? [mutation.slide.id] : []));
  const allowed = new Set([...target.slideIds, ...newIds]);
  if (!target.global) {
    if (
      args.scope.type === 'deck' ||
      (args.scope.type === 'slides' ? args.scope.slideIds : [args.scope.slideId]).some((id) => !allowed.has(id))
    )
      throw new Error('修改超出本次请求绑定的页面范围');
    for (const mutation of args.mutations) {
      if (mutation.type === 'set-language') throw new Error('局部请求不能修改整套语言');
      if (mutation.type === 'add-slide') {
        if (!target.allowNewSlides) throw new Error('新增页面超出请求范围');
        if (mutation.afterSlideId === null) {
          // 空锚点落在新增页所属章节的块首，该章现有首页必须仍在绑定范围内。
          const firstInSection = deck.slides.find((slide) => slide.sectionId === mutation.slide.sectionId);
          if (firstInSection && !target.slideIds.includes(firstInSection.id)) throw new Error('新增页面超出请求范围');
        } else if (!allowed.has(mutation.afterSlideId)) throw new Error('新增页面超出请求范围');
        continue;
      }
      if (!allowed.has(mutation.slideId)) throw new Error('修改超出本次请求绑定的页面范围');
    }
  }
  for (const mutation of args.mutations) {
    if (
      target.titleOnly &&
      (mutation.type !== 'update-slide' || Object.keys(mutation.changes).some((key) => key !== 'title'))
    )
      throw new Error('标题请求只能修改目标标题');
    if (target.elementId) {
      if (mutation.type === 'set-language' || mutation.type === 'add-slide')
        throw new Error('修改超出本次请求绑定的元素范围');
      const id =
        mutation.type === 'replace-element'
          ? mutation.element.id
          : mutation.type === 'delete-element'
            ? mutation.elementId
            : undefined;
      const layoutOnly =
        mutation.type === 'update-slide' && Object.keys(mutation.changes).every((key) => key === 'layoutId');
      if (id !== target.elementId && !layoutOnly) throw new Error('修改超出本次请求绑定的元素范围');
    }
    if (target.figureId) {
      if (mutation.type === 'set-language' || mutation.type === 'add-slide')
        throw new Error('Figure 请求不能改写其他内容');
      const previous = deck.slides.find((slide) => slide.id === mutation.slideId);
      const element =
        mutation.type === 'delete-element'
          ? previous?.elements.find((element) => element.id === mutation.elementId)
          : mutation.type === 'replace-element' || mutation.type === 'add-element'
            ? mutation.element
            : undefined;
      const layoutOnly =
        mutation.type === 'update-slide' && Object.keys(mutation.changes).every((key) => key === 'layoutId');
      const replaced =
        mutation.type === 'replace-element'
          ? previous?.elements.find((element) => element.id === mutation.element.id)
          : undefined;
      if (
        !layoutOnly &&
        (element?.type !== 'figure' ||
          element.figureId !== target.figureId ||
          (replaced && (replaced.type !== 'figure' || replaced.figureId !== target.figureId)))
      )
        throw new Error('Figure 请求不能改写其他内容');
    }
  }
  // 使用现有提交与布局校验，在独立内存会话中验证完整批次；不产生存储写入。
  const working = new DeckSession(deck, paper);
  await working.commit(args.scope, args.mutations, args.summary);
  const affectedSlideIds = [
    ...new Set(
      args.mutations.flatMap((mutation) =>
        mutation.type === 'set-language'
          ? deck.slides.map((slide) => slide.id)
          : mutation.type === 'add-slide'
            ? [mutation.slide.id]
            : [mutation.slideId],
      ),
    ),
  ];
  return { args, affectedSlideIds };
}
