import { DeckSchema } from './schema';
import { groupLeaves, groupRects } from '../layout';
import { figureArea } from '../layout/figureGeometry';
import { validateContent, validateSpeechAssignments } from '../content';
import type { Paper as LegacyPaper } from '../../paper/paper.schema';
import { type Paper as CurrentPaper, validatePaper as validateCurrentPaper } from '../../paper/model';
type Paper = LegacyPaper | CurrentPaper;
import { layoutCapacity } from './layoutRules';
import { figureSource, validatePaper } from '../../paper/sources';

/** 只校验 Deck 结构与引用自洽（schema、ID、章节归属/连续/顺序、布局与 Paper 引用）；学术叙事规则不在其中。 */
export function validateDeck(input: unknown, paper?: Paper) {
  const parsed = DeckSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const deck = parsed.data;
  const ids = new Set<string>();
  const errors: string[] = [];
  if (paper) {
    try {
      if (paper.schemaVersion === 2) validateCurrentPaper(paper);
      else validatePaper(paper);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (paper && deck.paperId !== paper.id) errors.push('Deck 不属于当前 Paper');
  const sectionIds = new Set<string>();
  deck.sections.forEach((section) => {
    if (ids.has(section.id)) errors.push('重复 section id');
    ids.add(section.id);
    sectionIds.add(section.id);
  });
  deck.slides.forEach((slide) => {
    if (ids.has(slide.id)) errors.push('重复 slide id');
    ids.add(slide.id);
    if (!sectionIds.has(slide.sectionId)) errors.push(`页章节不存在：${slide.id}`);
    if (!layoutCapacity(slide)) errors.push(`布局无法容纳当前元素：${slide.id}`);
    if (slide.figureGroup) {
      const leaves = groupLeaves(slide.figureGroup.root).sort();
      const images = slide.elements
        .filter((item) => item.type === 'figure')
        .map((item) => item.id)
        .sort();
      if (JSON.stringify(leaves) !== JSON.stringify(images)) errors.push('图组与页内图像不一致：' + slide.id);
      try {
        groupRects(slide.figureGroup, figureArea(slide));
      } catch {
        errors.push('图组几何无效：' + slide.id);
      }
    }
    slide.elements.forEach((element) => {
      if (ids.has(element.id)) errors.push('重复 element id');
      ids.add(element.id);
      if (paper && element.type === 'figure') {
        try {
          figureSource(paper, element);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        paper &&
        element.type === 'citation' &&
        element.sourceIds.some((id) => !paper.sources.some((source) => source.id === id))
      )
        errors.push(`来源不存在：${element.id}`);
    });
    if (paper && slide.sourceIds.some((id) => !paper.sources.some((source) => source.id === id)))
      errors.push(`页来源不存在：${slide.id}`);
    if (paper && slide.claimIds.some((id) => !paper.claims.some((claim) => claim.id === id)))
      errors.push(`页结论不存在：${slide.id}`);
  });
  if (deck.speechParagraphs !== undefined || deck.speech !== undefined) {
    try {
      const content = validateContent(
        {
          title: deck.title,
          language: deck.language,
          sections: deck.sections.map((s) => ({ ...s, track: s.track ?? 'main' })),
          speechParagraphs: deck.speechParagraphs ?? [],
          speech: deck.speech ?? [],
          omissions: deck.omissions ?? [],
        },
        paper ?? { claims: [], sources: [] },
      );
      validateSpeechAssignments(content, deck.slides);
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : '讲稿结构不一致');
    }
    // 已迁移讲述的章节次序独立于页面展示，新增空讲述章节不删除原页。
    return errors;
  }
  // 同章页面必须连续，且 sections 顺序与页面块顺序一致；runtime Deck 不保留空章节。
  const blocks: string[] = [];
  let blockSectionId: string | undefined;
  for (const slide of deck.slides) {
    if (slide.sectionId !== blockSectionId) {
      if (blocks.includes(slide.sectionId)) errors.push(`章节页面不连续：${slide.sectionId}`);
      blocks.push(slide.sectionId);
      blockSectionId = slide.sectionId;
    }
  }
  if (blocks.join() !== deck.sections.map((section) => section.id).join()) errors.push('章节顺序与页面排列不一致');
  deck.sections.forEach((section) => {
    if (!blocks.includes(section.id)) errors.push(`空章节：${section.id}`);
  });
  return errors;
}
