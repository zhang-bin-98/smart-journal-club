import { get, request, transaction, type Store } from './indexedDb';
import { openProject, projectIn, paperIn, projectDataIn } from './projectStore';
import type { PlanRecordContracts } from '../../app/presentation/planRecord';
import type { SlidesStore, SlidesWorkspace } from '../../app/presentation/slidesPorts';
import { migrateDeckV1 } from '../../modules/presentation/editing/migrateDeck';
import { validateDeck } from '../../modules/presentation/editing/validateDeck';
import { assertBuiltPlan, buildPresentation } from '../../modules/presentation/build';
import { ContentError } from '../../modules/presentation/content';
import { assertPlanningContent } from '../../modules/presentation/planning/paginateSpeech';
import { trimHistory } from './historyStore';
import type { Paper } from '../../modules/paper/model';
import type { Project } from '../../modules/project/model';
export function createSlidesStore({ parsePlanRecord, assertGenerationBase }: PlanRecordContracts): SlidesStore {
  const names: Store[] = ['projects', 'papers', 'plans', 'decks', 'assets', 'history'];
  const key = (value: unknown) => JSON.stringify(value) ?? '';
  async function read(tx: IDBTransaction, id: string): Promise<SlidesWorkspace> {
    const project = await projectIn(tx, id);
    const workingPaper = await paperIn(tx, project);
    const deck = async (deckId?: string) => {
      if (!deckId) return undefined;
      const result = migrateDeckV1(await get(tx, 'decks', deckId));
      if (result.id !== deckId) throw new ContentError('foreign-deck', '稿件身份不一致。');
      const paper = await paperIn(tx, project, result.paperId);
      if (result.paperRevision !== undefined && result.paperRevision !== paper.revision)
        throw new ContentError('paper-version', '稿件绑定论文版本已改变。');
      return result;
    };
    const current = await deck(project.currentDeckId);
    const previous = await deck(project.previousDeckId);
    const candidate = await deck(project.candidate?.deckId);
    const raw = await get<{ recordVersion?: number }>(tx, 'plans', id);
    const record = raw?.recordVersion === 2 ? parsePlanRecord(raw) : undefined;
    if (record && record.projectId !== id) throw new ContentError('foreign-plan', '计划不属于当前项目。');
    const paper = current ? await paperIn(tx, project, current.paperId) : workingPaper;
    const data = await projectDataIn(tx, project, paper);
    let candidateStale: string | undefined;
    if (project.candidate) {
      try {
        assertGenerationBase(project.candidate.base, project, workingPaper, current, previous);
      } catch {
        candidateStale = '当前稿、论文核对或项目要求已变化；这份新稿只能查看。';
      }
    }
    return {
      ...data,
      workingPaper,
      current,
      previous,
      candidate,
      candidatePaper: candidate ? await paperIn(tx, project, candidate.paperId) : undefined,
      previousPaper: previous ? await paperIn(tx, project, previous.paperId) : undefined,
      candidateStale,
      record,
      planKey: key(raw),
      candidateKey: key(project.candidate),
    };
  }
  /** Reclaim only this project's unreferenced complete decks and papers inside the successful transaction. */
  async function collect(tx: IDBTransaction, project: Project) {
    const keepDecks = new Set(
      [project.currentDeckId, project.previousDeckId, project.candidate?.deckId].filter(Boolean),
    );
    const keepPapers = new Set([project.paperId]);
    const raw = await get<{ plan?: { paperId: string } }>(tx, 'plans', project.id);
    if (raw?.plan?.paperId) keepPapers.add(raw.plan.paperId);
    const papers = (await request(tx.objectStore('papers').getAll())) as Paper[];
    const owned = new Set(papers.filter((paper) => paper.projectId === project.id).map((paper) => paper.id));
    const decks = (await request(tx.objectStore('decks').getAll())) as { id: string; paperId: string }[];
    const projects = (await request(tx.objectStore('projects').getAll())) as Project[];
    const foreignDecks = new Set(
      projects
        .filter((p) => p.id !== project.id)
        .flatMap((p) => [p.currentDeckId, p.previousDeckId, p.candidate?.deckId])
        .filter(Boolean),
    );
    const plans = (await request(tx.objectStore('plans').getAll())) as {
      projectId?: string;
      plan?: { paperId?: string };
    }[];
    if (
      projects.some((p) => p.id !== project.id && owned.has(p.paperId)) ||
      plans.some((p) => p.projectId !== project.id && p.plan?.paperId && owned.has(p.plan.paperId)) ||
      decks.some((d) => foreignDecks.has(d.id) && owned.has(d.paperId))
    ) {
      throw new ContentError('foreign-reference', '其他项目引用了本项目成果，已保留全部资料。');
    }
    for (const deck of decks) {
      if (keepDecks.has(deck.id)) {
        if (!owned.has(deck.paperId)) throw new ContentError('foreign-paper', '稿件引用了其他项目底稿。');
        keepPapers.add(deck.paperId);
      } else if (owned.has(deck.paperId)) tx.objectStore('decks').delete(deck.id);
    }
    for (const paper of papers)
      if (owned.has(paper.id) && !keepPapers.has(paper.id)) tx.objectStore('papers').delete(paper.id);
  }
  return {
    async open(id) {
      await openProject(id);
      return transaction(names, 'readonly', (tx) => read(tx, id));
    },
    async rememberSlide(projectId, deckId, slideId) {
      await transaction(['projects', 'decks'], 'readwrite', async (tx) => {
        const project = await projectIn(tx, projectId);
        const deck = await get<{ slides: { id: string }[] }>(tx, 'decks', deckId);
        if (project.currentDeckId !== deckId || !deck?.slides.some((s) => s.id === slideId)) return;
        tx.objectStore('projects').put({ ...project, lastOpenedSlideId: slideId }, projectId);
      });
    },
    savePlan(input) {
      return transaction(
        names,
        'readwrite',
        async (tx) => {
          input.assertActive();
          const record = parsePlanRecord(input.record);
          const state = await read(tx, record.projectId);
          assertGenerationBase(record.base, state.project, state.workingPaper, state.current, state.previous);
          if (state.planKey !== input.expectedPlan) throw new ContentError('stale-plan', '计划在生成期间已改变。');
          if (record.stage !== 'deck-plan-ready') throw new ContentError('plan-stage', '页面计划阶段无效。');
          if (!state.record) throw new ContentError('missing-plan', '已保存讲稿不存在。');
          assertPlanningContent(state.record.plan, record.plan);
          buildPresentation(record.plan, state.workingPaper, 'validation', 0);
          input.assertActive();
          tx.objectStore('plans').put(record, record.projectId);
          tx.objectStore('projects').put(
            { ...state.project, checkpoint: state.current ? 'deck-ready' : 'deck-plan-ready' },
            record.projectId,
          );
          return read(tx, record.projectId);
        },
        input.signal,
      );
    },
    saveBuild(input) {
      return transaction(
        names,
        'readwrite',
        async (tx) => {
          input.assertActive();
          const state = await read(tx, input.projectId);
          if (state.planKey !== input.expectedPlan || state.candidateKey !== input.expectedCandidate || !state.record)
            throw new ContentError('stale-build', '计划或新稿候选已变化，已有成果保留。');
          const record = state.record;
          assertGenerationBase(record.base, state.project, state.workingPaper, state.current, state.previous);
          assertBuiltPlan(input.deck, record.plan, state.workingPaper);
          if (await get(tx, 'decks', input.deck.id)) throw new ContentError('duplicate-deck', '稿件身份已存在。');
          const project: Project = { ...state.project, updatedAt: Date.now(), checkpoint: 'deck-ready' };
          if (record.mode === 'regeneration') {
            if (!state.current || !record.base.current)
              throw new ContentError('missing-current', '新稿候选缺少当前稿基准。');
            project.candidate = {
              deckId: input.deck.id,
              generatedFrom: { planId: record.plan.id, planRevision: record.plan.revision },
              generationPreferences: record.generationPreferences,
              base: record.base,
            };
          } else {
            if (state.current) throw new ContentError('current-exists', '当前稿已存在，不能直接覆盖。');
            project.currentDeckId = input.deck.id;
            project.preferences = record.generationPreferences;
            tx.objectStore('plans').delete(input.projectId);
          }
          input.assertActive();
          tx.objectStore('decks').put(input.deck, input.deck.id);
          tx.objectStore('projects').put(project, project.id);
          await collect(tx, project);
          return read(tx, input.projectId);
        },
        input.signal,
      );
    },
    candidate(input) {
      return transaction(names, 'readwrite', async (tx) => {
        input.assertActive();
        const state = await read(tx, input.projectId);
        const ref = state.project.candidate;
        if (!ref || state.candidateKey !== input.expectedCandidate || !state.candidate)
          throw new ContentError('stale-candidate', '新稿候选已被替换或放弃。');
        const project = { ...state.project, updatedAt: Date.now() };
        if (input.action === 'apply') {
          assertGenerationBase(ref.base, project, state.workingPaper, state.current, state.previous);
          const errors = validateDeck(state.candidate, state.candidatePaper);
          if (errors.length) throw new ContentError('invalid-candidate', errors.join('；'));
          project.previousDeckId = project.currentDeckId;
          project.currentDeckId = ref.deckId;
          project.preferences = ref.generationPreferences;
          if (
            state.record?.plan.id === ref.generatedFrom.planId &&
            state.record.plan.revision === ref.generatedFrom.planRevision
          )
            tx.objectStore('plans').delete(project.id);
        }
        delete project.candidate;
        input.assertActive();
        tx.objectStore('projects').put(project, project.id);
        await collect(tx, project);
        return read(tx, project.id);
      });
    },
    restore(input) {
      return transaction(names, 'readwrite', async (tx) => {
        input.assertActive();
        const state = await read(tx, input.projectId);
        if (
          state.current?.id !== input.currentId ||
          state.previous?.id !== input.previousId ||
          state.current.revision !== input.currentRevision ||
          state.previous.revision !== input.previousRevision
        )
          throw new ContentError('stale-version', '稿件版本已变化。');
        const project = {
          ...state.project,
          currentDeckId: input.previousId,
          previousDeckId: input.currentId,
          updatedAt: Date.now(),
        };
        // 恢复内容不恢复旧版本号，防止来回切版重新满足旧候选/请求的基准。
        const restored = { ...state.previous, revision: state.previous.revision + 1, updatedAt: project.updatedAt };
        input.assertActive();
        tx.objectStore('decks').put(restored, restored.id);
        tx.objectStore('projects').put(project, project.id);
        return read(tx, project.id);
      });
    },
    revision(projectId) {
      return (previous, next, record, options) =>
        transaction(
          names,
          'readwrite',
          async (tx) => {
            options?.signal?.throwIfAborted();
            if (options?.isTaskActive && !options.isTaskActive())
              throw new ContentError('inactive-edit', '修改已失效。');
            const state = await read(tx, projectId);
            if (
              state.current?.id !== previous.id ||
              state.current.revision !== previous.revision ||
              next.paperId !== previous.paperId ||
              next.paperRevision !== previous.paperRevision
            )
              throw new ContentError('stale-deck', '当前稿已变化，请重新打开。');
            if (await get(tx, 'history', record.id)) throw new ContentError('duplicate-request', '本次修改已保存。');
            const errors = validateDeck(next, state.paper);
            if (errors.length) throw new ContentError('invalid-deck', errors.join('；'));
            if (options?.isTaskActive && !options.isTaskActive())
              throw new ContentError('inactive-edit', '修改已失效。');
            tx.objectStore('decks').put(next, next.id);
            tx.objectStore('history').put(record, record.id);
            tx.objectStore('projects').put({ ...state.project, updatedAt: next.updatedAt }, projectId);
            await trimHistory(tx, projectId);
          },
          options?.signal,
        );
    },
  };
}
