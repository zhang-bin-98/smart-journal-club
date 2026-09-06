// 叙事校验基础 fixture：一篇合法的组学研究叙事（开场→背景+问题页→设计→结果×7→局限→综合→结论）。
// 结果页恰好占总页数一半、背景一页、各章有过渡，基础结构不产生任何 error 或 warning。
import type { Deck, SectionKind, SlideKind } from '../src/modules/deck/deck.schema';
import type { DeckPlan } from '../src/modules/outline/outline.schema';
import type { Paper } from '../src/modules/paper/paper.schema';
import { fixturePaper, fixtureSource } from './fixtures';

const now = 1_700_000_000_000;
export function narrativePaper(): Paper {
  return structuredClone(fixturePaper);
}
export function paperWithoutDesign(): Paper {
  const paper = narrativePaper();
  delete paper.studyProfile;
  return paper;
}
/** 扩展论文：第二个结论 claim-2 只被结果页引用一次，其证据来源是 source-fig-3-panel-a。 */
export function paperWithSecondClaim(): Paper {
  const paper = narrativePaper();
  paper.sources.push({
    id: 'source-panel-a',
    kind: 'panel',
    pageNumber: 1,
    bbox: { x: 0.12, y: 0.2, width: 0.3, height: 0.28 },
  });
  paper.evidences.push({ id: 'evidence-2', kind: '图源', summary: '第二项证据', sourceIds: ['source-panel-a'] });
  paper.claims.push({
    id: 'claim-2',
    text: '固定第二结论',
    strength: 'descriptive',
    importance: 'secondary',
    evidenceIds: ['evidence-2'],
  });
  return paper;
}

const sectionDefs: { id: string; kind: SectionKind; title: string }[] = [
  { id: 'n-sec-opening', kind: 'opening', title: '开场' },
  { id: 'n-sec-background', kind: 'background', title: '背景与研究问题' },
  { id: 'n-sec-study-design', kind: 'study-design', title: '研究设计' },
  { id: 'n-sec-results', kind: 'results', title: '主要结果' },
  { id: 'n-sec-limitations', kind: 'limitations', title: '研究的局限' },
  { id: 'n-sec-synthesis', kind: 'synthesis', title: '综合' },
  { id: 'n-sec-takeaways', kind: 'takeaways', title: '结论' },
];
type SlideDef = {
  id: string;
  sectionId: string;
  kind: SlideKind;
  title: string;
  message: string;
  layoutId: 'title' | 'text-only' | 'figure-full';
  purpose?: string;
  figures?: { figureId: string; panelId?: string }[];
};
const resultSlide = (index: number): SlideDef => ({
  id: `n-slide-result-${index}`,
  sectionId: 'n-sec-results',
  kind: 'result',
  title: `结局 ${index} 的组间差异`,
  message: `处理组在结局 ${index} 上出现一致方向的变化。`,
  layoutId: index === 1 ? 'figure-full' : 'text-only',
  purpose: `说明结局 ${index} 的证据与方向。`,
  figures: index === 1 ? [{ figureId: 'fig-3' }] : [],
});
export const slideDefs: SlideDef[] = [
  {
    id: 'n-slide-title',
    sectionId: 'n-sec-opening',
    kind: 'title',
    title: '一项可追溯的组学研究',
    message: '',
    layoutId: 'title',
  },
  {
    id: 'n-slide-background',
    sectionId: 'n-sec-background',
    kind: 'background',
    title: '已有认识与空白',
    message: '该通路在人群中的证据仍不一致。',
    layoutId: 'text-only',
  },
  {
    id: 'n-slide-question',
    sectionId: 'n-sec-background',
    kind: 'question',
    title: '研究问题',
    message: '该处理是否改变主要终点。',
    layoutId: 'text-only',
  },
  {
    id: 'n-slide-method',
    sectionId: 'n-sec-study-design',
    kind: 'method',
    title: '队列与研究设计',
    message: '使用固定样本与预设终点。',
    layoutId: 'text-only',
  },
  ...[1, 2, 3, 4, 5, 6, 7].map(resultSlide),
  {
    id: 'n-slide-limitations',
    sectionId: 'n-sec-limitations',
    kind: 'discussion',
    title: '研究的局限',
    message: '样本规模限制了亚组结论。',
    layoutId: 'text-only',
  },
  {
    id: 'n-slide-synthesis',
    sectionId: 'n-sec-synthesis',
    kind: 'summary',
    title: '结果的共同模式',
    message: '多项结局指向同一处理效应。',
    layoutId: 'text-only',
  },
  {
    id: 'n-slide-takeaways',
    sectionId: 'n-sec-takeaways',
    kind: 'conclusion',
    title: '带走什么',
    message: '该处理效应稳健且证据可追溯。',
    layoutId: 'text-only',
  },
];
const transition = '进入下一部分';
export function narrativePlan(status: 'draft' | 'confirmed' = 'draft'): DeckPlan {
  const base = {
    schemaVersion: 2 as const,
    id: 'narrative-plan',
    paperId: fixturePaper.id,
    title: '叙事校验固定计划',
    language: 'zh-CN',
    revision: 0,
    sections: sectionDefs.map((section, index) => ({
      ...section,
      purpose: `${section.title}的叙事职责`,
      transitionToNext: index === sectionDefs.length - 1 ? undefined : transition,
      slideBudget: slideDefs.filter((slide) => slide.sectionId === section.id).length,
    })),
    slides: slideDefs.map((slide) => ({
      id: slide.id,
      sectionId: slide.sectionId,
      kind: slide.kind,
      title: slide.title,
      purpose: slide.purpose ?? `${slide.title}的页面职责`,
      message: slide.message,
      layoutId: slide.layoutId,
      claimIds: slide.kind === 'result' ? ['claim-fixture'] : [],
      sourceIds: slide.kind === 'result' ? [fixtureSource.id] : [],
      figures: slide.figures ?? [],
    })),
    claimEmphasis: [],
    createdAt: now,
    updatedAt: now,
  };
  return status === 'confirmed'
    ? { ...base, status: 'confirmed' as const, confirmedAt: now + 1 }
    : { ...base, status: 'draft' as const };
}
export function narrativeDeck(): Deck {
  return {
    schemaVersion: 2,
    id: 'narrative-deck',
    paperId: fixturePaper.id,
    revision: 0,
    title: '叙事校验固定文稿',
    language: 'zh-CN',
    sections: sectionDefs.map((section, index) => ({
      ...section,
      purpose: `${section.title}的叙事职责`,
      transitionToNext: index === sectionDefs.length - 1 ? undefined : transition,
    })),
    slides: slideDefs.map((slide) => ({
      id: slide.id,
      sectionId: slide.sectionId,
      kind: slide.kind,
      title: slide.title,
      message: slide.message,
      layoutId: slide.layoutId,
      elements: (slide.figures ?? []).map((figure) => ({
        id: `${slide.id}-figure`,
        type: 'figure' as const,
        figureId: figure.figureId,
        panelId: figure.panelId,
      })),
      claimIds: slide.kind === 'result' ? ['claim-fixture'] : [],
      sourceIds: slide.kind === 'result' ? [fixtureSource.id] : [],
    })),
    createdAt: now,
    updatedAt: now,
  };
}
