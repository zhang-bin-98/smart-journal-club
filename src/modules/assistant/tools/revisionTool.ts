import { z } from 'zod';
import { ApplyRevisionArgsSchema, DeckMutationSchema, RevisionScopeSchema } from '../../deck/deck.schema';
import type { AiTarget } from '../target/resolveTarget';

export function revisionToolSchema(target: AiTarget) {
  const slideIds =
    !target.global && !target.allowNewSlides && target.slideIds.length
      ? z.array(z.enum(target.slideIds as [string, ...string[]])).min(1)
      : RevisionScopeSchema.options[1].shape.slideIds;
  const slides = RevisionScopeSchema.options[1]
    .extend({ slideIds })
    .describe('页面属性（含标题、布局）、批量或新增删除页面使用此范围；包含所有受影响原页和本批新页。');
  const scope = target.elementId
    ? z.union([
        slides,
        RevisionScopeSchema.options[0]
          .extend({ slideId: z.literal(target.slideIds[0]), elementId: z.literal(target.elementId) })
          .describe('仅替换或删除已绑定元素；修改页面标题或布局不能使用此范围。'),
      ])
    : target.global && !target.titleOnly && !target.figureId
      ? z.union([slides, RevisionScopeSchema.options[2]])
      : slides;
  const mutations = target.titleOnly
    ? z
        .array(
          DeckMutationSchema.options[3].extend({
            changes: DeckMutationSchema.options[3].shape.changes.pick({ title: true }).required(),
          }),
        )
        .min(1)
    : ApplyRevisionArgsSchema.shape.mutations;
  return ApplyRevisionArgsSchema.extend({ scope, mutations });
}
