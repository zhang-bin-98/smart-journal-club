import type { BBox, Deck } from './types';
export const fixtureSource = { id: 'source-fig-3', pageNumber: 1, bbox: { x: .12, y: .2, width: .76, height: .58 } satisfies BBox };
export const fixtureDeck: Deck = { schemaVersion: 1, id: 'fixture-deck', revision: 0, title: 'smartJC fixture', language: 'zh-CN', slides: [
  { id: 'slide-1', title: '一个可追溯的研究结论', layoutId: 'title', elements: [{ id: 't1', type: 'text', text: '从 PDF 图源到可编辑 PPTX' }] },
  { id: 'slide-2', title: 'Figure 3 展示处理组的差异', message: '保留原图与证据来源，避免把相关性写成因果。', layoutId: 'figure-text', elements: [{ id: 'f1', type: 'figure', figureId: 'fig-3' }, { id: 'b1', type: 'bullet-list', items: ['效应方向与原图一致', '来源标签固定显示'] }] },
  { id: 'slide-3', title: '结论与证据链', layoutId: 'two-figures', elements: [{ id: 'f2', type: 'figure', figureId: 'fig-3' }, { id: 'f3', type: 'figure', figureId: 'fig-3' }] }
] };
