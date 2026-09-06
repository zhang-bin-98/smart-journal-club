import { get, stored, transaction } from '../../shared/persistence/indexedDb';
import { prompts } from '../../shared/llm/prompts';
import { PaperSchema, type Paper } from '../paper/paper.schema';
import { validatePaper } from '../paper/sources';
import { PlanRecordSchema } from '../outline/planRecord.schema';
import { projectIn, type ProjectData } from './projectRepository';
import { ProjectSchema, type PdfAsset } from './project.schema';
import { DeckSchema } from '../deck/deck.schema';

export class ReanalysisError extends Error {
  readonly stage = 'reanalysis';
  readonly recovery = '重新打开项目核对已有成果，再重试重新分析。';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Capture = Pick<ProjectData, 'project' | 'paper' | 'plan'>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** 复制完整解析/图源到新项目；原论文、两版文稿和候选记录始终只读。 */
export function createReanalysisProject(projectId: string, instruction: string, signal: AbortSignal) {
  return transaction(
    ['projects', 'papers', 'assets', 'decks'],
    'readwrite',
    async (tx) => {
      const original = await projectIn(tx, projectId);
      if (original.checkpoint !== 'deck-ready' || !original.currentDeckId)
        throw new ReanalysisError('invalid-stage', '当前项目尚无可用文稿，请在原项目中重新分析。');
      const paper = validatePaper(stored(PaperSchema, await get(tx, 'papers', original.paperId), '论文'), true);
      const asset = await get<PdfAsset>(tx, 'assets', original.pdfAssetId);
      if (!(asset?.blob instanceof Blob) || !paper.pages.length || paper.id !== original.paperId)
        throw new ReanalysisError('missing-pdf', '原论文或 PDF 缺失，无法建立新分析项目。');
      for (const id of [original.currentDeckId, original.previousDeckId]) {
        if (!id) continue;
        const deck = DeckSchema.parse(await get(tx, 'decks', id));
        if (deck.id !== id || deck.paperId !== paper.id)
          throw new ReanalysisError('invalid-association', '原文稿与论文关联不一致。');
      }
      const now = Date.now();
      const { strategyId, ...preferences } = original.preferences;
      const project = ProjectSchema.parse({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        paperId: crypto.randomUUID(),
        pdfAssetId: crypto.randomUUID(),
        name: `${original.name}（重新分析）`,
        nameIsCustom: true,
        checkpoint: 'figures-ready',
        preferences: { ...preferences, instruction },
        createdAt: now,
        updatedAt: now,
      });
      const prepared = validatePaper({
        schemaVersion: 1,
        id: project.paperId,
        metadata: {},
        pages: paper.pages,
        sources: paper.sources,
        figures: paper.figures,
        claims: [],
        evidences: [],
      });
      signal.throwIfAborted();
      tx.objectStore('projects').add(project, project.id);
      tx.objectStore('papers').add(prepared, prepared.id);
      tx.objectStore('assets').add(asset, project.pdfAssetId);
      return project;
    },
    signal,
  );
}

export function assertReanalysisAvailable({ project, paper, plan }: Capture) {
  if (
    project.currentDeckId ||
    project.previousDeckId ||
    !['figures-ready', 'paper-ready', 'deck-plan-ready'].includes(project.checkpoint)
  )
    throw new ReanalysisError('invalid-stage', '当前项目不能直接重新分析；已有文稿须在新项目中重新分析。');
  if (!paper.pages.length || paper.id !== project.paperId || (project.checkpoint === 'deck-plan-ready') !== !!plan)
    throw new ReanalysisError('invalid-capture', '论文理解或计划关联已变化。');
}

/** 复核完整旧 Paper、计划版本、偏好和 PDF 关联，成功才替换分析、消费计划；失败整批回滚。 */
export function saveReanalysis({
  captured,
  paper,
  instruction,
  strategyId,
  signal,
}: {
  captured: Capture;
  paper: Paper;
  instruction: string;
  strategyId: string;
  signal: AbortSignal;
}) {
  const base = structuredClone(captured);
  assertReanalysisAvailable(base);
  const nextPaper = validatePaper(paper, true);
  if (!prompts.strategies.some((strategy) => strategy.id === strategyId))
    throw new ReanalysisError('invalid-strategy', '研究叙事策略不存在。');
  if (
    nextPaper.id !== base.paper.id ||
    !same(nextPaper.pages, base.paper.pages) ||
    !same(nextPaper.sources, base.paper.sources) ||
    !same(nextPaper.figures, base.paper.figures)
  )
    throw new ReanalysisError('changed-sources', '重新分析不得改变原 PDF 解析和图源。');
  return transaction(
    ['projects', 'papers', 'plans', 'assets'],
    'readwrite',
    async (tx) => {
      const project = await projectIn(tx, base.project.id);
      const current = stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文');
      const raw = await get(tx, 'plans', project.id);
      const record = raw === undefined ? undefined : PlanRecordSchema.parse(raw);
      if (
        project.checkpoint !== base.project.checkpoint ||
        project.currentDeckId ||
        project.previousDeckId ||
        project.paperId !== base.project.paperId ||
        project.pdfAssetId !== base.project.pdfAssetId ||
        !same(project.preferences, base.project.preferences) ||
        !same(current, base.paper) ||
        !same(record?.plan, base.plan) ||
        (record && (record.mode !== 'initial' || record.projectId !== project.id))
      )
        throw new ReanalysisError('stale-analysis', '论文理解、大纲或项目已变化，本次重新分析未保存。');
      const asset = await get<PdfAsset>(tx, 'assets', project.pdfAssetId);
      if (!(asset?.blob instanceof Blob)) throw new ReanalysisError('missing-pdf', '原 PDF 缺失，不能替换论文理解。');
      const next = ProjectSchema.parse({
        ...project,
        checkpoint: 'paper-ready',
        name: !project.nameIsCustom && nextPaper.metadata.title ? nextPaper.metadata.title : project.name,
        preferences: { ...project.preferences, instruction, strategyId },
        updatedAt: Date.now(),
      });
      signal.throwIfAborted();
      tx.objectStore('papers').put(nextPaper, nextPaper.id);
      tx.objectStore('plans').delete(project.id);
      tx.objectStore('projects').put(next, next.id);
      return { project: next, paper: nextPaper };
    },
    signal,
  );
}
