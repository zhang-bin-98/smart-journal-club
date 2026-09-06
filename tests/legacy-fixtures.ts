// v1 fixture 按 M9.1 之前的真实持久化形状构造（deck.schema/outline.schema/tests/fixtures @ fab3c06），
// 不是“当前 v2 删几个字段”；字段集合与当时 stored() 读取契约一致。
import type { LegacyDeckV1 } from '../src/modules/deck/migrateDeck';
import type { LegacyDeckPlanV1 } from '../src/modules/outline/migrateDeckPlan';
import type { Project } from '../src/modules/project/project.schema';
import { fixturePaper, fixtureSource } from './fixtures';

export const legacyCreatedAt = 1_700_000_000_000;
export const legacyUpdatedAt = 1_700_000_000_500;
export function legacyDeckV1(deckId: string): LegacyDeckV1 {
  return {
    schemaVersion: 1,
    id: deckId,
    paperId: fixturePaper.id,
    revision: 3,
    title: 'legacy fixture',
    language: 'zh-CN',
    createdAt: legacyCreatedAt,
    updatedAt: legacyUpdatedAt,
    slides: [
      {
        id: `${deckId}-slide-1`,
        kind: 'title',
        title: '开场页',
        layoutId: 'title',
        elements: [{ id: `${deckId}-t1`, type: 'text', text: 'legacy 开场' }],
        claimIds: [],
        sourceIds: [],
      },
      {
        id: `${deckId}-slide-2`,
        kind: 'result',
        title: '结果一',
        message: '旧 message 保留',
        layoutId: 'figure-full',
        elements: [
          {
            id: `${deckId}-f1`,
            type: 'figure',
            figureId: 'fig-3',
            cropOverride: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
          },
        ],
        claimIds: ['claim-fixture'],
        sourceIds: [fixtureSource.id],
      },
      {
        id: `${deckId}-slide-3`,
        kind: 'result',
        title: '结果二',
        layoutId: 'figure-text',
        elements: [
          { id: `${deckId}-f2`, type: 'figure', figureId: 'fig-3' },
          { id: `${deckId}-b1`, type: 'bullet-list', items: ['legacy 列表'] },
        ],
        claimIds: [],
        sourceIds: [fixtureSource.id],
      },
      {
        id: `${deckId}-slide-4`,
        kind: 'summary',
        title: '总结页',
        layoutId: 'text-only',
        elements: [{ id: `${deckId}-t2`, type: 'text', text: 'legacy 总结' }],
        claimIds: [],
        sourceIds: [],
      },
    ],
  };
}
export function legacyDeckPlanV1(): LegacyDeckPlanV1 {
  return {
    schemaVersion: 1,
    paperId: fixturePaper.id,
    title: 'legacy plan',
    language: 'zh-CN',
    slides: [
      {
        id: 'legacy-plan-slide-1',
        kind: 'title',
        title: '开场',
        layoutId: 'title',
        claimIds: [],
        sourceIds: [],
        figures: [],
      },
      {
        id: 'legacy-plan-slide-2',
        kind: 'result',
        title: '结果',
        message: '旧 message 保留',
        layoutId: 'figure-full',
        claimIds: ['claim-fixture'],
        sourceIds: [fixtureSource.id],
        figures: [{ figureId: 'fig-3' }],
      },
    ],
  };
}
export function legacyProject(options: {
  id: string;
  paperId: string;
  pdfAssetId: string;
  checkpoint: Project['checkpoint'];
  currentDeckId?: string;
  previousDeckId?: string;
}): Project {
  return {
    schemaVersion: 1,
    id: options.id,
    name: 'legacy 项目',
    paperId: options.paperId,
    pdfAssetId: options.pdfAssetId,
    checkpoint: options.checkpoint,
    ...(options.currentDeckId ? { currentDeckId: options.currentDeckId } : {}),
    ...(options.previousDeckId ? { previousDeckId: options.previousDeckId } : {}),
    preferences: { instruction: '', strategyId: 'general' },
    createdAt: legacyCreatedAt,
    updatedAt: legacyUpdatedAt,
  };
}
