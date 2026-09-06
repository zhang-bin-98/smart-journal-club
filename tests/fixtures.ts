import type { BBox } from '../src/shared/schema';
import type { Deck } from '../src/modules/deck/deck.schema';
import type { Paper } from '../src/modules/paper/paper.schema';
export const fixtureSource = {
  id: 'source-fig-3',
  kind: 'figure' as const,
  pageNumber: 1,
  bbox: { x: 0.12, y: 0.2, width: 0.76, height: 0.58 } satisfies BBox,
};
export const fixturePaper: Paper = {
  schemaVersion: 1,
  id: 'paper-fixture',
  metadata: { title: 'smartJC fixture paper' },
  pages: [{ pageNumber: 1, width: 800, height: 600, text: 'Fixture source page' }],
  sources: [fixtureSource],
  figures: [
    {
      id: 'fig-3',
      label: 'Figure 3',
      sourceId: fixtureSource.id,
      panels: [{ id: 'fig-3-panel-a', label: 'A', sourceId: fixtureSource.id }],
    },
  ],
  claims: [],
  evidences: [],
};
const now = Date.now();
fixturePaper.studyProfile = { type: '固定研究类型', designSummary: '固定设计说明', sourceIds: [fixtureSource.id] };
fixturePaper.claims = [
  {
    id: 'claim-fixture',
    text: '固定结论',
    strength: 'descriptive',
    importance: 'primary',
    evidenceIds: ['evidence-fixture'],
  },
];
fixturePaper.evidences = [{ id: 'evidence-fixture', kind: '图源', summary: '固定证据', sourceIds: [fixtureSource.id] }];
fixturePaper.story = {
  background: [],
  knowledgeGap: [],
  question: [],
  studyDesign: [],
  mainFindings: [{ text: '固定发现', claimIds: ['claim-fixture'], sourceIds: [] }],
  novelty: [],
  limitations: [],
  conclusion: [],
};
export const fixtureDeck: Deck = {
  schemaVersion: 2,
  id: 'fixture-deck',
  paperId: fixturePaper.id,
  revision: 0,
  title: 'smartJC fixture',
  language: 'zh-CN',
  sections: [
    { id: 'sec-opening', kind: 'opening', title: '开场', purpose: '说明研究主题与汇报目标' },
    { id: 'sec-results', kind: 'results', title: '主要结果', purpose: '呈现核心发现及其证据' },
    { id: 'sec-takeaways', kind: 'takeaways', title: '结论', purpose: '汇总结论与证据链' },
  ],
  createdAt: now,
  updatedAt: now,
  slides: [
    {
      id: 'slide-1',
      sectionId: 'sec-opening',
      kind: 'title',
      title: '一个可追溯的研究结论',
      layoutId: 'title',
      elements: [{ id: 't1', type: 'text', text: '从 PDF 图源到可编辑 PPTX' }],
      claimIds: [],
      sourceIds: [],
    },
    {
      id: 'slide-2',
      sectionId: 'sec-results',
      kind: 'result',
      title: 'Figure 3 展示处理组的差异',
      purpose: '说明处理组差异的方向与原图证据',
      message: '保留原图与证据来源，避免把相关性写成因果。',
      layoutId: 'figure-text',
      elements: [
        { id: 'f1', type: 'figure', figureId: 'fig-3' },
        { id: 'b1', type: 'bullet-list', items: ['效应方向与原图一致', '来源标签固定显示'] },
        { id: 'c1', type: 'citation', sourceIds: [fixtureSource.id] },
      ],
      claimIds: [],
      sourceIds: [fixtureSource.id],
    },
    {
      id: 'slide-3',
      sectionId: 'sec-takeaways',
      kind: 'summary',
      title: '结论与证据链',
      layoutId: 'two-figures',
      elements: [
        { id: 'f2', type: 'figure', figureId: 'fig-3' },
        { id: 'f3', type: 'figure', figureId: 'fig-3' },
      ],
      claimIds: [],
      sourceIds: [fixtureSource.id],
    },
  ],
};
