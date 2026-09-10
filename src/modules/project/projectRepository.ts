import {
  readLegacyPaper,
  readLegacyProject,
  writeLegacyProject,
} from '../../infrastructure/persistence/legacyCompatibility';
import { deleteProject as deleteManagedProject } from '../../infrastructure/persistence/projectStore';
import { UnsupportedSchemaVersionError } from '../../shared/errors/migration';
import { prompts } from '../../shared/llm/prompts';
import { get, request, stored, stores, transaction } from '../../shared/persistence/indexedDb';
import { type Deck, DeckSchema, DeckSchemaVersion, type RevisionRecord } from '../deck/deck.schema';
import { migrateDeckV1, readableSlideCount, schemaVersionOf } from '../deck/migrateDeck';
import { validateDeck } from '../deck/validateDeck';
import { validateBuiltDeckAgainstPlan } from '../generation/validateBuiltDeckAgainstPlan';
import { migratePlanV1 } from '../outline/migrateDeckPlan';
import { type DeckPlan, DeckPlanSchema } from '../outline/outline.schema';
import { OutlineError } from '../outline/outlineError';
import { assertPlanBase } from '../outline/outlineRepository';
import { type PlanRecord, PlanRecordSchema } from '../outline/planRecord.schema';
import { validatePlan } from '../outline/validatePlan';
import { toLegacyProject } from '../paper/migration';
import { validatePaper as validateCurrentPaper } from '../paper/model';
import type { Paper } from '../paper/paper.schema';
import { validatePaper } from '../paper/sources';
import { ProjectSchema as CurrentProjectSchema, ProjectError } from './model';
import { type PdfAsset, type Project, ProjectSchema } from './project.schema';

export async function projectIn(tx: IDBTransaction, id: string) {
  const value = await get<Project>(tx, 'projects', id);
  if (!value) throw new Error('项目已被删除，请返回首页');
  return readLegacyProject(tx, id);
}
export async function createProject(file: File): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: file.name.replace(/\.pdf$/i, '') || file.name,
    paperId: crypto.randomUUID(),
    pdfAssetId: crypto.randomUUID(),
    checkpoint: 'project-created',
    preferences: { instruction: '' },
    createdAt: now,
    updatedAt: now,
  };
  const paper: Paper = {
    schemaVersion: 1,
    id: project.paperId,
    metadata: {},
    pages: [],
    sources: [],
    figures: [],
    claims: [],
    evidences: [],
  };
  await transaction(['projects', 'papers', 'assets'], 'readwrite', async (tx) => {
    tx.objectStore('projects').add(project, project.id);
    tx.objectStore('papers').add(paper, paper.id);
    tx.objectStore('assets').add({ blob: file, name: file.name } satisfies PdfAsset, project.pdfAssetId);
  });
  return project;
}
export function listProjects() {
  return transaction(['projects', 'decks'], 'readonly', async (tx) => {
    const items = (await request(tx.objectStore('projects').getAll()))
      .map((value) => stored(ProjectSchema, value, '项目'))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(
      items.map(async (project) => {
        const value = project.currentDeckId ? await get(tx, 'decks', project.currentDeckId) : undefined;
        return {
          project,
          slideCount: value === undefined ? undefined : readableSlideCount(value),
        };
      }),
    );
  });
}
export type ProjectData = {
  project: Project;
  paper: Paper;
  asset?: PdfAsset;
  deck?: Deck;
  plan?: DeckPlan;
  planPaper?: Paper;
  planRecord?: PlanRecord;
  candidateStale?: boolean;
  legacyGenerationAllowed?: boolean;
};
function planRecord(project: Project, plan: DeckPlan): PlanRecord {
  return PlanRecordSchema.parse({
    recordVersion: 1,
    projectId: project.id,
    mode: 'initial',
    plan,
    preferences: project.preferences,
  });
}
// v1 Deck/Plan 在同一 readwrite 事务内确定性迁移并原子写回；全部已是 v2 时不产生任何写入。
export function loadProject(id: string): Promise<ProjectData> {
  return transaction(['projects', 'papers', 'assets', 'decks', 'plans'], 'readwrite', async (tx) => {
    let project = await projectIn(tx, id);
    const canonical = await get(tx, 'projects', id);
    if ((canonical as { schemaVersion?: number })?.schemaVersion === 2 && project.currentDeckId) {
      const current = await get<{ paperId: string }>(tx, 'decks', project.currentDeckId);
      if (current) {
        const bound = validateCurrentPaper(await get(tx, 'papers', current.paperId));
        if (bound.projectId !== id) throw new Error('旧稿底稿归属不一致');
        project = { ...toLegacyProject(CurrentProjectSchema.parse(canonical), bound), paperId: bound.id };
      }
    }
    const paper = validatePaper(
      await readLegacyPaper(tx, project.paperId, project.id),
      ['paper-ready', 'deck-plan-ready', 'deck-ready'].includes(project.checkpoint),
    );
    const asset = await get<PdfAsset>(tx, 'assets', project.pdfAssetId);
    if (paper.id !== project.paperId) throw new Error('论文关联不一致');
    if (project.checkpoint !== 'project-created' && !paper.pages.length)
      throw new Error('已保存阶段缺少解析结果，请保留项目并检查本地存储');
    const currentRaw = project.currentDeckId ? await get(tx, 'decks', project.currentDeckId) : undefined;
    if (project.currentDeckId && currentRaw === undefined)
      throw new Error('幻灯片数据缺失，请保留项目并检查本地存储。');
    const previousRaw = project.previousDeckId ? await get(tx, 'decks', project.previousDeckId) : undefined;
    if (project.previousDeckId && previousRaw === undefined)
      throw new OutlineError('missing-previous', '上一版幻灯片数据缺失，请保留项目并检查本地存储。');
    const deck = currentRaw === undefined ? undefined : migrateDeckV1(currentRaw);
    const previous = previousRaw === undefined ? undefined : migrateDeckV1(previousRaw);
    if (project.checkpoint === 'deck-ready' && !deck) throw new Error('已保存的幻灯片缺失');
    for (const candidate of [deck, previous]) {
      if (!candidate) continue;
      const errors = validateDeck(
        candidate,
        candidate.paperId === paper.id ? paper : await readLegacyPaper(tx, candidate.paperId, project.id),
      );
      if (errors.length) throw new Error(errors.join('；'));
    }
    let plan: DeckPlan | undefined;
    let discardLegacyPlan = false;
    let planWasLegacy = false;
    let wrapPlan = false;
    let planRecordValue: PlanRecord | undefined;
    let candidateStale = false;
    if (project.checkpoint === 'deck-plan-ready' || project.checkpoint === 'deck-ready') {
      const raw = await get(tx, 'plans', id);
      if (raw === undefined && project.checkpoint === 'deck-plan-ready')
        throw new Error('汇报计划数据缺失，请保留项目并检查本地存储。');
      if (raw !== undefined) {
        const wrapped = raw && typeof raw === 'object' && 'recordVersion' in raw;
        const record = wrapped ? PlanRecordSchema.parse(raw) : undefined;
        if (record && record.projectId !== project.id)
          throw new Error('汇报计划关联不一致，请保留项目并检查本地存储。');
        wrapPlan = !wrapped;
        const candidate = record ? record.plan : raw;
        planWasLegacy = schemaVersionOf(candidate) === 1;
        try {
          plan = validatePlan(
            migratePlanV1(candidate, {
              projectId: project.id,
              projectCreatedAt: project.createdAt,
              projectUpdatedAt: project.updatedAt,
            }),
            record?.plan.paperId && record.plan.paperId !== paper.id
              ? await readLegacyPaper(tx, record.plan.paperId, project.id)
              : paper,
          );
        } catch (cause) {
          // 未来版本与当前格式损坏照常报错；仅无法安全迁移的 v1 临时计划原子回退，等待重新规划。
          if (cause instanceof UnsupportedSchemaVersionError || !planWasLegacy) throw cause;
          discardLegacyPlan = true;
        }
        planRecordValue = record ?? (plan ? planRecord(project, plan) : undefined);
        if (planRecordValue) {
          try {
            await assertPlanBase(tx, planRecordValue, project);
          } catch (cause) {
            const migratedPaperConflict =
              (canonical as { schemaVersion?: number })?.schemaVersion === 2 &&
              planRecordValue.plan.paperId !== project.paperId;
            if (!(cause instanceof OutlineError) || (cause.code !== 'stale-candidate' && !migratedPaperConflict))
              throw cause;
            candidateStale = true;
          }
        }
      }
    }
    if (deck && currentRaw !== undefined && schemaVersionOf(currentRaw) === 1)
      tx.objectStore('decks').put(deck, deck.id);
    if (previous && previousRaw !== undefined && schemaVersionOf(previousRaw) === 1)
      tx.objectStore('decks').put(previous, previous.id);
    let opened = project;
    if (discardLegacyPlan) {
      tx.objectStore('plans').delete(id);
      if (!deck) {
        opened = ProjectSchema.parse({ ...project, checkpoint: 'paper-ready' });
        await writeLegacyProject(tx, opened);
      }
    } else if (plan && wrapPlan) {
      tx.objectStore('plans').put(planRecord(opened, plan), id);
    }
    return {
      project: opened,
      paper,
      asset: asset?.blob instanceof Blob ? asset : undefined,
      deck,
      plan,
      planRecord: planRecordValue,
      planPaper: plan ? await readLegacyPaper(tx, plan.paperId, project.id) : undefined,
      candidateStale,
      legacyGenerationAllowed: (canonical as { schemaVersion?: number })?.schemaVersion === 1,
    };
  });
}
export function updateProject(
  id: string,
  changes: Partial<Pick<Project, 'name' | 'preferences' | 'lastOpenedSlideId'>>,
) {
  return transaction(['projects', 'papers', 'decks'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, id);
    if ('lastOpenedSlideId' in changes && changes.lastOpenedSlideId) {
      const deck = project.currentDeckId
        ? stored(DeckSchema, await get(tx, 'decks', project.currentDeckId), '当前幻灯片', DeckSchemaVersion)
        : undefined;
      if (!deck?.slides.some((slide) => slide.id === changes.lastOpenedSlideId))
        throw new Error('当前页已变化，请重新打开项目');
    }
    const next = ProjectSchema.parse({
      ...project,
      ...changes,
      nameIsCustom: 'name' in changes ? true : project.nameIsCustom,
      updatedAt: Date.now(),
    });
    await writeLegacyProject(tx, next);
    return next;
  });
}
export async function deleteProject(id: string) {
  const value = await transaction(['projects'], 'readonly', (tx) => get<{ schemaVersion: number }>(tx, 'projects', id));
  if (value?.schemaVersion === 2) return deleteManagedProject(id);
  return transaction([...stores.filter((store) => store !== 'settings')], 'readwrite', async (tx) => {
    const project = await projectIn(tx, id);
    tx.objectStore('projects').delete(id);
    tx.objectStore('papers').delete(project.paperId);
    tx.objectStore('assets').delete(project.pdfAssetId);
    tx.objectStore('plans').delete(id);
    if (project.currentDeckId) tx.objectStore('decks').delete(project.currentDeckId);
    if (project.previousDeckId) tx.objectStore('decks').delete(project.previousDeckId);
    const history = (await request(tx.objectStore('history').getAll())) as RevisionRecord[];
    history
      .filter((item) => item.projectId === id)
      .forEach((item) => {
        tx.objectStore('history').delete(item.id);
      });
  });
}

export type StageCapture = Pick<Project, 'id' | 'paperId' | 'pdfAssetId' | 'checkpoint'>;
type StageOutput =
  | { checkpoint: 'pdf-parsed' | 'figures-ready'; paper: Paper }
  | { checkpoint: 'paper-ready'; paper: Paper; strategyId: string }
  | { checkpoint: 'deck-plan-ready'; plan: DeckPlan }
  | { checkpoint: 'deck-ready'; deck: Deck; strategyId: string; planId: string; planRevision: number };
export function saveStage(captured: StageCapture, output: StageOutput, signal: AbortSignal) {
  const prior = {
    'pdf-parsed': 'project-created',
    'figures-ready': 'pdf-parsed',
    'paper-ready': 'figures-ready',
    'deck-plan-ready': 'paper-ready',
    'deck-ready': 'deck-plan-ready',
  }[output.checkpoint];
  if ('strategyId' in output && !prompts.strategies.some((strategy) => strategy.id === output.strategyId))
    throw new Error('研究叙事策略不存在');
  if (captured.checkpoint !== prior) throw new Error('阶段产物或顺序不正确');
  return transaction(
    ['projects', 'papers', 'assets', 'plans', 'decks'],
    'readwrite',
    async (tx) => {
      if ((await get<{ schemaVersion: number }>(tx, 'projects', captured.id))?.schemaVersion === 2)
        throw new Error('该项目已升级，请从论文分析工作台继续。');
      const project = await projectIn(tx, captured.id);
      if (
        project.checkpoint !== captured.checkpoint ||
        project.paperId !== captured.paperId ||
        project.pdfAssetId !== captured.pdfAssetId
      )
        throw new Error('项目阶段已在其他页面变化，请重新打开');
      if (!((await get<PdfAsset>(tx, 'assets', project.pdfAssetId))?.blob instanceof Blob))
        throw new Error('原 PDF 缺失，无法保存本阶段');
      const savedPaper = await readLegacyPaper(tx, project.paperId, project.id);
      if (savedPaper.id !== project.paperId) throw new Error('论文关联不一致');
      const paper = validatePaper(
        'paper' in output ? output.paper : savedPaper,
        ['paper-ready', 'deck-plan-ready', 'deck-ready'].includes(output.checkpoint),
      );
      if (paper.id !== captured.paperId || !paper.pages.length) throw new Error('阶段产物或论文关联不正确');
      if (output.checkpoint === 'deck-plan-ready') validatePlan(output.plan, paper);
      if (output.checkpoint === 'deck-ready') {
        const rawPlan = await get(tx, 'plans', project.id);
        const planValue =
          rawPlan && typeof rawPlan === 'object' && 'recordVersion' in rawPlan
            ? PlanRecordSchema.parse(rawPlan).plan
            : rawPlan;
        const plan = validatePlan(stored(DeckPlanSchema, planValue, '汇报计划', DeckSchemaVersion), paper);
        const errors = validateDeck(output.deck, paper);
        if (
          errors.length ||
          !output.deck.slides.length ||
          output.deck.revision !== 0 ||
          output.deck.slides.length !== plan.slides.length ||
          output.deck.slides.some((slide, i) => slide.id !== plan.slides[i].id) ||
          plan.id !== output.planId ||
          plan.revision !== output.planRevision ||
          validateBuiltDeckAgainstPlan(output.deck, plan).length
        )
          throw new Error(`完整幻灯片或计划关联无效：${errors.join('；')}`);
      }
      signal.throwIfAborted();
      const next: Project = {
        ...project,
        name: !project.nameIsCustom && paper.metadata.title ? paper.metadata.title : project.name,
        checkpoint: output.checkpoint,
        updatedAt: Date.now(),
      };
      if (output.checkpoint === 'paper-ready')
        next.preferences = { ...project.preferences, strategyId: output.strategyId };
      if ('paper' in output) tx.objectStore('papers').put(paper, paper.id);
      if (output.checkpoint === 'deck-plan-ready')
        tx.objectStore('plans').put(planRecord(project, output.plan), project.id);
      if (output.checkpoint === 'deck-ready') {
        tx.objectStore('decks').add(output.deck, output.deck.id);
        tx.objectStore('plans').delete(project.id);
        next.currentDeckId = output.deck.id;
        next.lastOpenedSlideId = output.deck.slides[0].id;
        next.preferences = { ...project.preferences, strategyId: output.strategyId };
      }
      await writeLegacyProject(tx, next);
      return next;
    },
    signal,
  );
}

/** 历史单文件生成仅处理尚未升级的记录；升级后必须在调用模型前切换到工作台流程。 */
export function assertLegacyGeneration(projectId: string) {
  return transaction(['projects'], 'readonly', async (tx) => {
    const project = await get<{ schemaVersion?: number }>(tx, 'projects', projectId);
    if (project?.schemaVersion !== 1)
      throw new ProjectError(
        'legacy-generation-disabled',
        '请从论文分析工作台继续；已保存的讲稿和幻灯片仍可查看、编辑与导出。',
      );
  });
}
