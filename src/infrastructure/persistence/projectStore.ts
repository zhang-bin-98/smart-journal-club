import { readableSlideCount } from '../../modules/deck/migrateDeck';
import { getAnalysisProgress } from '../../modules/paper/analysisUnits';
import { migratePaperV1, migrateProjectV1 } from '../../modules/paper/migration';
import { type Paper, validatePaper } from '../../modules/paper/model';
import {
  type PdfAsset,
  type Preferences,
  PreferencesSchema,
  type Project,
  ProjectError,
  ProjectSchema,
  type WorkspaceStep,
} from '../../modules/project/model';
import { ProjectSchema as LegacyProjectSchema } from '../../modules/project/project.schema';
import { get, request, stores, transaction } from '../../shared/persistence/indexedDb';

export type OpenProject = { project: Project; paper: Paper; assets: Record<string, PdfAsset> };
export type CreateProjectInput = {
  primary: File;
  supplement?: File;
  name?: string;
  nameIsCustom?: boolean;
  preferences?: Preferences;
};

export async function projectIn(tx: IDBTransaction, projectId: string): Promise<Project> {
  const value = await get(tx, 'projects', projectId);
  if (!value) throw new ProjectError('missing-project', '项目已被删除。');
  return ProjectSchema.parse(value);
}
export async function paperIn(tx: IDBTransaction, project: Project, paperId = project.paperId): Promise<Paper> {
  const paper = validatePaper(await get(tx, 'papers', paperId));
  if (paper.id !== paperId || paper.projectId !== project.id)
    throw new ProjectError('foreign-paper', '论文底稿不属于当前项目。');
  return paper;
}

/** 返回同一事务中读取的固定文件映射，不以提交后的第二次读取代替保存结果。 */
export async function projectDataIn(tx: IDBTransaction, project: Project, paper: Paper): Promise<OpenProject> {
  const assets: Record<string, PdfAsset> = {};
  for (const document of paper.documents) {
    const asset = await get<PdfAsset>(tx, 'assets', document.pdfAssetId);
    if (asset?.blob instanceof Blob) assets[document.id] = asset;
  }
  return { project, paper, assets };
}
/** 读取并原子升级项目及稿件引用的全部旧底稿；任何失败均回滚原记录。 */
export function openProject(projectId: string): Promise<OpenProject> {
  return transaction(['projects', 'papers', 'assets', 'decks', 'plans'], 'readwrite', async (tx) => {
    const raw = await get(tx, 'projects', projectId);
    if (!raw) throw new ProjectError('missing-project', '项目已被删除。');
    const plan = await get<{ plan?: { paperId?: string }; paperId?: string }>(tx, 'plans', projectId);
    const project = migrateProjectV1(raw, !!plan);
    if (project.id !== projectId) throw new ProjectError('foreign-project', '项目身份与存储键不一致。');
    const paperIds = new Set([project.paperId]);
    for (const deckId of [project.currentDeckId, project.previousDeckId, project.candidate?.deckId]) {
      if (!deckId) continue;
      const deck = await get<{ id: string; paperId: string }>(tx, 'decks', deckId);
      if (!deck || deck.id !== deckId) throw new ProjectError('missing-deck', '已保存稿件缺失，现有项目保留。');
      paperIds.add(deck.paperId);
    }
    const planPaperId = plan?.plan?.paperId ?? plan?.paperId;
    if (planPaperId) paperIds.add(planPaperId);
    const old = (raw as { schemaVersion?: number }).schemaVersion === 1 ? LegacyProjectSchema.parse(raw) : undefined;
    const oldAsset = old ? await get<PdfAsset>(tx, 'assets', old.pdfAssetId) : undefined;
    // 旧 Paper 不携带 projectId；迁移前检查其他项目的所有保存指针，不能猜测归属。
    if (old) {
      const allProjects = (await request(tx.objectStore('projects').getAll())) as {
        id: string;
        paperId: string;
        currentDeckId?: string;
        previousDeckId?: string;
        candidate?: { deckId: string };
      }[];
      for (const other of allProjects) {
        if (other.id === project.id) continue;
        if (paperIds.has(other.paperId)) throw new ProjectError('foreign-paper', '旧底稿同时被其他项目引用，未迁移。');
        for (const deckId of [other.currentDeckId, other.previousDeckId, other.candidate?.deckId]) {
          if (!deckId) continue;
          const deck = await get<{ paperId: string }>(tx, 'decks', deckId);
          if (deck && paperIds.has(deck.paperId))
            throw new ProjectError('foreign-paper', '旧稿底稿属于其他项目，未迁移。');
        }
      }
    }
    let paper: Paper | undefined;
    let fixedDocuments: string | undefined;
    for (const id of paperIds) {
      const value = await get(tx, 'papers', id);
      const migrated = old ? migratePaperV1(value, old, oldAsset?.name ?? `${project.name}.pdf`) : validatePaper(value);
      if (migrated.id !== id || migrated.projectId !== project.id)
        throw new ProjectError('foreign-paper', '稿件引用了其他项目的论文底稿。');
      const mapping = JSON.stringify(migrated.documents.map((doc) => [doc.id, doc.role, doc.pdfAssetId]));
      if (fixedDocuments !== undefined && fixedDocuments !== mapping)
        throw new ProjectError('changed-documents', '项目稿件的固定文件集合不一致。');
      fixedDocuments = mapping;
      if (id === project.paperId) paper = migrated;
      if ((value as { schemaVersion?: number })?.schemaVersion === 1) tx.objectStore('papers').put(migrated, id);
    }
    if (!paper) throw new ProjectError('missing-paper', '论文底稿缺失。');
    if (old) tx.objectStore('projects').put(project, project.id);
    return projectDataIn(tx, project, paper);
  });
}

/** 先检查完整文件集合，再在一个事务创建项目、底稿及所有 Blob。 */
export async function createProject(input: CreateProjectInput): Promise<OpenProject> {
  const files = [input.primary, ...(input.supplement ? [input.supplement] : [])];
  for (const file of files) {
    if (!(file instanceof Blob) || !file.size) throw new ProjectError('invalid-pdf', '请选择非空 PDF 文件。');
    const header = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-')) throw new ProjectError('invalid-pdf', '所选文件不是可识别的 PDF。');
  }
  const now = Date.now();
  const project = ProjectSchema.parse({
    schemaVersion: 2,
    id: crypto.randomUUID(),
    paperId: crypto.randomUUID(),
    name: input.name?.trim() || input.primary.name.replace(/\.pdf$/i, ''),
    nameIsCustom: input.nameIsCustom ?? !!input.name?.trim(),
    checkpoint: 'project-created',
    preferences: input.preferences ?? { instruction: '' },
    lastOpenedStep: 'paper-analysis',
    createdAt: now,
    updatedAt: now,
  });
  const documents = files.map((file, index) => ({
    id: crypto.randomUUID(),
    role: index === 0 ? ('primary' as const) : ('supplement' as const),
    fileName: file.name,
    pdfAssetId: crypto.randomUUID(),
  }));
  const paper = validatePaper({
    schemaVersion: 2,
    id: project.paperId,
    projectId: project.id,
    revision: 0,
    documents,
    metadata: {},
    pages: [],
    blocks: [],
    sources: [],
    figures: [],
    claims: [],
    evidences: [],
    figurePageSelections: [],
    analysisUnits: [],
    figureReview: { revision: 0 },
    pendingEvidenceFigureIds: [],
  });
  const assets = Object.fromEntries(
    documents.map((document, index) => [document.id, { blob: files[index], name: files[index].name }]),
  );
  await transaction(['projects', 'papers', 'assets'], 'readwrite', async (tx) => {
    tx.objectStore('projects').add(project, project.id);
    tx.objectStore('papers').add(paper, paper.id);
    documents.forEach((document) => {
      tx.objectStore('assets').add(assets[document.id], document.pdfAssetId);
    });
  });
  return { project, paper, assets };
}

export function listProjects() {
  return transaction(['projects', 'decks', 'plans', 'papers', 'assets'], 'readonly', async (tx) => {
    const raw = (await request(tx.objectStore('projects').getAll())) as unknown[];
    const items = [];
    for (const value of raw) {
      const candidate = value as { id: string };
      const plan = await get(tx, 'plans', candidate.id);
      const project = migrateProjectV1(value, !!plan);
      const deck = project.currentDeckId ? await get(tx, 'decks', project.currentDeckId) : undefined;
      const rawPaper = await get(tx, 'papers', project.paperId);
      const legacy =
        (value as { schemaVersion?: number }).schemaVersion === 1 ? LegacyProjectSchema.parse(value) : undefined;
      const asset = legacy ? await get<PdfAsset>(tx, 'assets', legacy.pdfAssetId) : undefined;
      const paper = legacy
        ? migratePaperV1(rawPaper, legacy, asset?.name ?? `${project.name}.pdf`)
        : validatePaper(rawPaper);
      if (paper.projectId !== project.id) throw new ProjectError('foreign-paper', '论文不属于当前项目。');
      items.push({ project, paper, slideCount: deck ? readableSlideCount(deck) : undefined });
    }
    return items.sort((a, b) => b.project.updatedAt - a.project.updatedAt);
  });
}

export async function renameProject(projectId: string, name: string) {
  await openProject(projectId);
  return transaction(['projects'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, projectId);
    const next = ProjectSchema.parse({ ...project, name, nameIsCustom: true, updatedAt: Date.now() });
    tx.objectStore('projects').put(next, projectId);
    return next;
  });
}
export async function saveRequirements(projectId: string, preferences: Preferences) {
  const normalized = PreferencesSchema.parse(preferences);
  await openProject(projectId);
  return transaction(['projects'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, projectId);
    const next = { ...project, preferences: normalized, updatedAt: Date.now() };
    tx.objectStore('projects').put(next, projectId);
    return next;
  });
}

/** 导航仅修改最近位置，保留产物版本、checkpoint 及候选。 */
export async function openStep(projectId: string, step: WorkspaceStep) {
  await openProject(projectId);
  return transaction(['projects', 'papers', 'plans', 'decks'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, projectId);
    const paper = await paperIn(tx, project);
    if (step === 'figure-review' && !getAnalysisProgress(paper).ready)
      throw new ProjectError('analysis-incomplete', '请先完成论文分析。');
    if (
      step === 'outline-speech' &&
      !(await get(tx, 'plans', project.id)) &&
      !project.currentDeckId &&
      paper.figureReview.confirmedRevision !== paper.figureReview.revision
    )
      throw new ProjectError('outline-missing', '尚未保存讲稿。');
    if (step === 'slides' && !project.currentDeckId && !(await get(tx, 'plans', project.id)))
      throw new ProjectError('deck-missing', '尚未保存幻灯片。');
    const next = { ...project, lastOpenedStep: step };
    tx.objectStore('projects').put(next, project.id);
    return next;
  });
}

export async function deleteProject(projectId: string) {
  await openProject(projectId);
  return transaction(
    stores.filter((store) => store !== 'settings'),
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, projectId);
      const papers = ((await request(tx.objectStore('papers').getAll())) as Paper[]).filter(
        (paper) => paper.projectId === project.id,
      );
      const paperIds = new Set(papers.map((paper) => paper.id));
      const assetIds = new Set(papers.flatMap((paper) => paper.documents.map((doc) => doc.pdfAssetId)));
      const allPapers = (await request(tx.objectStore('papers').getAll())) as Paper[];
      for (const other of allPapers.filter((paper) => !paperIds.has(paper.id))) {
        for (const doc of other.documents ?? [])
          if (assetIds.has(doc.pdfAssetId))
            throw new ProjectError('shared-foreign-asset', '资源被其他项目引用，未执行删除。');
      }
      const decks = (await request(tx.objectStore('decks').getAll())) as { id: string; paperId: string }[];
      const deckIds = new Set(decks.filter((deck) => paperIds.has(deck.paperId)).map((deck) => deck.id));
      const otherProjects = (await request(tx.objectStore('projects').getAll())) as {
        id: string;
        paperId: string;
        pdfAssetId?: string;
        currentDeckId?: string;
        previousDeckId?: string;
        candidate?: { deckId: string };
      }[];
      for (const other of otherProjects) {
        if (other.id === project.id) continue;
        if (
          paperIds.has(other.paperId) ||
          (other.pdfAssetId && assetIds.has(other.pdfAssetId)) ||
          [other.currentDeckId, other.previousDeckId, other.candidate?.deckId].some((id) => id && deckIds.has(id))
        )
          throw new ProjectError('foreign-reference', '项目资源被其他项目引用，未执行删除。');
      }
      const plans = (await request(tx.objectStore('plans').getAll())) as {
        projectId?: string;
        plan?: { paperId?: string };
        paperId?: string;
      }[];
      for (const plan of plans) {
        const paperId = plan.plan?.paperId ?? plan.paperId;
        if (plan.projectId && plan.projectId !== project.id && paperId && paperIds.has(paperId))
          throw new ProjectError('foreign-reference', '论文底稿被其他项目计划引用，未执行删除。');
      }
      for (const deck of decks) if (paperIds.has(deck.paperId)) tx.objectStore('decks').delete(deck.id);
      for (const id of paperIds) tx.objectStore('papers').delete(id);
      for (const id of assetIds) tx.objectStore('assets').delete(id);
      tx.objectStore('projects').delete(project.id);
      tx.objectStore('plans').delete(project.id);
      const history = (await request(tx.objectStore('history').getAll())) as { id: string; projectId: string }[];
      for (const item of history) if (item.projectId === project.id) tx.objectStore('history').delete(item.id);
    },
  );
}

export async function readStorageOverview() {
  const assets = await transaction(
    ['assets'],
    'readonly',
    async (tx) => (await request(tx.objectStore('assets').getAll())) as PdfAsset[],
  );
  let estimate: StorageEstimate | undefined;
  let estimateStatus: 'available' | 'unavailable' | 'failed' = 'unavailable';
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      estimate = await Promise.race([
        navigator.storage.estimate(),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 2500);
        }),
      ]);
      estimateStatus = estimate ? 'available' : 'unavailable';
    } catch {
      estimateStatus = 'failed';
      /* 容量未知不影响项目读取。 */
    } finally {
      clearTimeout(timer);
    }
  }
  const usage =
    estimate?.usage !== undefined && Number.isFinite(estimate.usage) && estimate.usage >= 0
      ? estimate.usage
      : undefined;
  const quota =
    estimate?.quota !== undefined && Number.isFinite(estimate.quota) && estimate.quota > 0 ? estimate.quota : undefined;
  return {
    estimateStatus,
    pdfBytes: assets.reduce((sum, item) => sum + (item.blob instanceof Blob ? item.blob.size : 0), 0),
    assetCount: assets.filter((item) => item.blob instanceof Blob).length,
    usage,
    quota,
    remaining: usage !== undefined && quota !== undefined ? Math.max(0, quota - usage) : undefined,
  };
}

/** 汇报要求只修改 instruction，事务内保留其他同时已保存的偏好。 */
export async function saveInstruction(projectId: string, instruction: string) {
  await openProject(projectId);
  return transaction(['projects'], 'readwrite', async (tx) => {
    const project = await projectIn(tx, projectId);
    const preferences = PreferencesSchema.parse({ ...project.preferences, instruction });
    const next = { ...project, preferences, updatedAt: Date.now() };
    tx.objectStore('projects').put(next, projectId);
    return next;
  });
}
