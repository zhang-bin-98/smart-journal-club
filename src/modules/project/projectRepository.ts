import { get, request, stored, stores, transaction } from '../../shared/persistence/indexedDb';
import { ProjectSchema, type PdfAsset, type Project } from './project.schema';
import { PaperSchema, type Paper } from '../paper/paper.schema';
import { DeckSchema, DeckSchemaVersion, type Deck, type RevisionRecord } from '../deck/deck.schema';
import { DeckPlanSchema, type DeckPlan } from '../outline/outline.schema';
import { validatePlan } from '../outline/validatePlan';
import { validateDeck } from '../deck/validateDeck';
import { validatePaper } from '../paper/sources';
import { prompts } from '../../shared/llm/prompts';

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
          slideCount:
            value === undefined ? undefined : stored(DeckSchema, value, '幻灯片', DeckSchemaVersion).slides.length,
        };
      }),
    );
  });
}
export type ProjectData = { project: Project; paper: Paper; asset?: PdfAsset; deck?: Deck; plan?: DeckPlan };
export function loadProject(id: string): Promise<ProjectData> {
  return transaction(['projects', 'papers', 'assets', 'decks', 'plans'], 'readonly', async (tx) => {
    const project = await projectIn(tx, id);
    const paper = validatePaper(
      stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文'),
      ['paper-ready', 'deck-plan-ready', 'deck-ready'].includes(project.checkpoint),
    );
    const asset = await get<PdfAsset>(tx, 'assets', project.pdfAssetId);
    const deck = project.currentDeckId
      ? stored(DeckSchema, await get(tx, 'decks', project.currentDeckId), '幻灯片', DeckSchemaVersion)
      : undefined;
    if (paper.id !== project.paperId) throw new Error('论文关联不一致');
    if (project.checkpoint !== 'project-created' && !paper.pages.length)
      throw new Error('已保存阶段缺少解析结果，请保留项目并检查本地存储');
    if (project.checkpoint === 'deck-ready' && !deck) throw new Error('已保存的幻灯片缺失');
    if (deck) {
      const errors = validateDeck(deck, paper);
      if (errors.length) throw new Error(errors.join('；'));
    }
    const plan =
      project.checkpoint === 'deck-plan-ready'
        ? validatePlan(stored(DeckPlanSchema, await get(tx, 'plans', id), '汇报计划', DeckSchemaVersion), paper)
        : undefined;
    return { project, paper, asset: asset?.blob instanceof Blob ? asset : undefined, deck, plan };
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
  | { checkpoint: 'deck-ready'; deck: Deck; strategyId: string };
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
        const plan = validatePlan(
          stored(DeckPlanSchema, await get(tx, 'plans', project.id), '汇报计划', DeckSchemaVersion),
          paper,
        );
        const errors = validateDeck(output.deck, paper);
        if (
          errors.length ||
          !output.deck.slides.length ||
          output.deck.revision !== 0 ||
          output.deck.slides.length !== plan.slides.length ||
          output.deck.slides.some((slide, i) => slide.id !== plan.slides[i].id)
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
      if (output.checkpoint === 'deck-plan-ready') tx.objectStore('plans').put(output.plan, project.id);
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
