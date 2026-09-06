import { get, request, stored, stores, transaction } from '../../shared/persistence/indexedDb';
import { ProjectSchema, type PdfAsset, type Project } from './project.schema';
import { PaperSchema, type Paper } from '../paper/paper.schema';
import { DeckSchema, DeckSchemaVersion, type Deck, type RevisionRecord } from '../deck/deck.schema';
import { migrateDeckV1, readableSlideCount, schemaVersionOf } from '../deck/migrateDeck';
import { DeckPlanSchema, type DeckPlan } from '../outline/outline.schema';
import { PlanRecordSchema, type PlanRecord } from '../outline/planRecord.schema';
import { migratePlanV1 } from '../outline/migrateDeckPlan';
import { UnsupportedSchemaVersionError } from '../../shared/errors/migration';
import { validatePlan } from '../outline/validatePlan';
import { validateDeck } from '../deck/validateDeck';
import { validatePaper } from '../paper/sources';
import { prompts } from '../../shared/llm/prompts';
import { validateBuiltDeckAgainstPlan } from '../generation/validateBuiltDeckAgainstPlan';
import { assertPlanBase } from '../outline/outlineRepository';
import { OutlineError } from '../outline/outlineError';

export async function projectIn(tx: IDBTransaction, id: string) {
  const value = await get<Project>(tx, 'projects', id);
  if (!value) throw new Error('项目已被删除，请返回首页');
  return stored(ProjectSchema, value, '项目');
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
  planRecord?: PlanRecord;
  candidateStale?: boolean;
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
    const project = await projectIn(tx, id);
    const paper = validatePaper(
      stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文'),
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
    const deck = currentRaw === undefined ? undefined : migrateDeckV1(currentRaw);
    const previous = previousRaw === undefined ? undefined : migrateDeckV1(previousRaw);
    if (project.checkpoint === 'deck-ready' && !deck) throw new Error('已保存的幻灯片缺失');
    for (const candidate of [deck, previous]) {
      if (!candidate) continue;
      const errors = validateDeck(candidate, paper);
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
        if (record && (record.projectId !== project.id || record.plan.paperId !== project.paperId))
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
            paper,
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
            if (!(cause instanceof OutlineError) || cause.code !== 'stale-candidate') throw cause;
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
      opened = ProjectSchema.parse({ ...project, checkpoint: 'paper-ready' });
      tx.objectStore('projects').put(opened, id);
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
      candidateStale,
    };
  });
}
export function updateProject(
  id: string,
  changes: Partial<Pick<Project, 'name' | 'preferences' | 'lastOpenedSlideId'>>,
) {
  return transaction(['projects', 'decks'], 'readwrite', async (tx) => {
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
    tx.objectStore('projects').put(next, id);
    return next;
  });
}
export function deleteProject(id: string) {
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
      const project = await projectIn(tx, captured.id);
      if (
        project.checkpoint !== captured.checkpoint ||
        project.paperId !== captured.paperId ||
        project.pdfAssetId !== captured.pdfAssetId
      )
        throw new Error('项目阶段已在其他页面变化，请重新打开');
      if (!((await get<PdfAsset>(tx, 'assets', project.pdfAssetId))?.blob instanceof Blob))
        throw new Error('原 PDF 缺失，无法保存本阶段');
      const savedPaper = stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文');
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
      tx.objectStore('projects').put(next, next.id);
      return next;
    },
    signal,
  );
}
