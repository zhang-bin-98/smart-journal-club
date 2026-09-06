import { z } from 'zod';
import { DeckSchema, SlideSchema, type Deck, type DeckSection, type SectionKind, type SlideKind } from './deck.schema';
import { LegacyMigrationError, UnsupportedSchemaVersionError } from '../../shared/errors/migration';

// v1 持久化形状逐字段恢复自 M9.1 之前的 deck.schema.ts（M0–M8 期间未变化），只服务迁移边界，不进入运行时契约。
export const LegacyDeckV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  paperId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  title: z.string(),
  language: z.string().min(1),
  slides: z.array(SlideSchema.omit({ sectionId: true, purpose: true })),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type LegacyDeckV1 = z.infer<typeof LegacyDeckV1Schema>;

// 连续同 kind 页面段确定性归并为章节；kind → 章节职责对应架构文档第 4 节，title/purpose 为中性说明，不猜科学语义。
const SectionRoles: Record<SlideKind, { kind: SectionKind; title: string; purpose: string }> = {
  title: { kind: 'opening', title: '开场', purpose: '说明研究主题与汇报结构' },
  background: { kind: 'background', title: '背景', purpose: '介绍研究背景与已有认识' },
  question: { kind: 'question', title: '研究问题', purpose: '提出本研究要回答的问题' },
  method: { kind: 'study-design', title: '研究设计', purpose: '说明回答问题的研究设计与方法' },
  result: { kind: 'results', title: '结果', purpose: '呈现研究发现及其证据' },
  summary: { kind: 'synthesis', title: '综合', purpose: '汇总结果并提炼整体结论' },
  discussion: { kind: 'discussion', title: '讨论', purpose: '解释研究发现的含义' },
  conclusion: { kind: 'takeaways', title: '结论', purpose: '总结希望听众记住的要点' },
  custom: { kind: 'custom', title: '其他内容', purpose: '承载不属于以上职责的补充内容' },
};
/** 旧计划页面缺省的页职责：中性确定性描述，供 PlannedSlide.purpose 使用。 */
export const LegacySlidePurposes: Record<SlideKind, string> = {
  title: '开场标题页',
  background: '交代研究背景',
  question: '提出研究问题',
  method: '说明研究方法',
  result: '呈现一项结果',
  summary: '总结要点',
  discussion: '讨论研究发现',
  conclusion: '给出研究结论',
  custom: '补充内容',
};
export type LegacySectionRun = { kind: SlideKind; sectionId: string; slideIds: string[] };
/** 章节 ID 由 owner（Deck/Plan）ID 与段首 slideId 派生：不依赖序号，重排前方页面不改变已有章节 ID。 */
export function legacySectionRuns(ownerId: string, slides: { id: string; kind: SlideKind }[]): LegacySectionRun[] {
  const runs: LegacySectionRun[] = [];
  for (const slide of slides) {
    const run = runs.at(-1);
    if (run && run.kind === slide.kind) run.slideIds.push(slide.id);
    else runs.push({ kind: slide.kind, sectionId: `${ownerId}-${slide.id}-section`, slideIds: [slide.id] });
  }
  return runs;
}
export function legacySectionOf(run: LegacySectionRun): DeckSection {
  const role = SectionRoles[run.kind];
  return { id: run.sectionId, kind: role.kind, title: role.title, purpose: role.purpose };
}
export function schemaVersionOf(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw)) return undefined;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' ? version : undefined;
}
/** v1 Deck 惰性确定性迁移；已是 v2 时原样返回，不产生任何新值、时间或随机 ID。 */
export function migrateDeckV1(raw: unknown): Deck {
  const parsed = DeckSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const version = schemaVersionOf(raw);
  if (version === undefined || version > 2)
    throw new UnsupportedSchemaVersionError('幻灯片数据版本与当前应用不兼容，请更新应用后重试；项目数据已保留。');
  const legacy = LegacyDeckV1Schema.safeParse(raw);
  if (!legacy.success) throw new LegacyMigrationError('旧幻灯片数据无法安全升级，已保留原数据。');
  const runs = legacySectionRuns(legacy.data.id, legacy.data.slides);
  const sectionIds = new Map(runs.flatMap((run) => run.slideIds.map((slideId) => [slideId, run.sectionId])));
  const deck: Deck = {
    ...legacy.data,
    schemaVersion: 2,
    sections: runs.map(legacySectionOf),
    slides: legacy.data.slides.map((slide) => ({ ...slide, sectionId: sectionIds.get(slide.id)! })),
  };
  const result = DeckSchema.safeParse(deck);
  if (!result.success) throw new LegacyMigrationError('旧幻灯片数据无法安全升级，已保留原数据。');
  return result.data;
}
/** 首页列表只读页数：v1/v2 均可识别；无法识别的记录不阻塞项目列表。 */
export function readableSlideCount(raw: unknown): number | undefined {
  const current = DeckSchema.safeParse(raw);
  if (current.success) return current.data.slides.length;
  const legacy = LegacyDeckV1Schema.safeParse(raw);
  if (legacy.success) return legacy.data.slides.length;
  return undefined;
}
