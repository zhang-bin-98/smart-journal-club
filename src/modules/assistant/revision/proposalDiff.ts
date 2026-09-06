import type { Deck, Element, Slide } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import { layoutLabels } from '../../deck/layoutRules';

function content(element: Element | undefined, paper: Paper): string {
  if (!element) return '无';
  if (element.type === 'text') return element.text;
  if (element.type === 'bullet-list') return element.items.join('；');
  if (element.type === 'citation')
    return element.sourceIds
      .map((id) => `原文第 ${paper.sources.find((source) => source.id === id)?.pageNumber ?? '?'} 页`)
      .join('；');
  const figure = paper.figures.find((item) => item.id === element.figureId);
  const panel = figure?.panels.find((item) => item.id === element.panelId);
  return `${figure?.label ?? '图'} ${panel?.label ?? ''}${element.cropOverride ? '（裁图覆盖）' : ''}`;
}
/** 比较模拟后的完整页面，避免模型摘要遗漏实际改动。 */
export function proposalDiff(
  before: Slide | undefined,
  after: Slide | undefined,
  paper: Paper,
  decks: { before: Deck; after: Deck },
) {
  const rows: { key: string; label: string; before: string; after: string }[] = [];
  const row = (key: string, label: string, old: string | undefined, next: string | undefined) => {
    if (old !== next) rows.push({ key, label, before: old || '无', after: next || '无' });
  };
  row('title', '标题', before?.title, after?.title);
  row('purpose', '页目的', before?.purpose, after?.purpose);
  row('message', '本页结论', before?.message, after?.message);
  row('layout', '布局', before && layoutLabels[before.layoutId], after && layoutLabels[after.layoutId]);
  row('language', '语言', decks.before.language, decks.after.language);
  row(
    'section',
    '章节',
    decks.before.sections.find((section) => section.id === before?.sectionId)?.title,
    decks.after.sections.find((section) => section.id === after?.sectionId)?.title,
  );
  row(
    'position',
    '页码',
    before && String(decks.before.slides.indexOf(before) + 1),
    after && String(decks.after.slides.indexOf(after) + 1),
  );
  const claims = (slide?: Slide) =>
    slide?.claimIds.map((id) => paper.claims.find((claim) => claim.id === id)?.text ?? '未知结论').join('；');
  const sources = (slide?: Slide) =>
    slide?.sourceIds
      .map((id) => `原文第 ${paper.sources.find((source) => source.id === id)?.pageNumber ?? '?'} 页`)
      .join('；');
  row('claims', '结论依据', claims(before), claims(after));
  row('sources', '来源', sources(before), sources(after));
  const ids = new Set([
    ...(before?.elements.map((element) => element.id) ?? []),
    ...(after?.elements.map((element) => element.id) ?? []),
  ]);
  for (const id of ids) {
    const old = before?.elements.find((element) => element.id === id);
    const next = after?.elements.find((element) => element.id === id);
    if (JSON.stringify(old) !== JSON.stringify(next)) {
      const previousText = content(old, paper);
      const nextText = content(next, paper);
      rows.push({
        key: `element-${id}`,
        label: '内容',
        before: previousText,
        after: previousText === nextText ? `${nextText}（属性或来源调整）` : nextText,
      });
    }
  }
  return rows;
}
