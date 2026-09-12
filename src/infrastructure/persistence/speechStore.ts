import { get, request, transaction } from '../../shared/persistence/indexedDb';
import { openProject, projectIn, paperIn } from './projectStore';
import { assertGenerationBase, PlanRecordSchema } from '../../app/presentation/planRecord';
import type { SpeechStore, SpeechWorkspace } from '../../app/presentation/ports';
import {
  ContentError,
  contentOf,
  validateContent,
  validateSpeechAssignments,
} from '../../modules/presentation/content';
import { migrateDeckV1 } from '../../modules/deck/migrateDeck';
import { trimHistory } from '../../shared/persistence/historyStore';

async function read(tx: IDBTransaction, projectId: string, preferPlan = false): Promise<SpeechWorkspace> {
  const project = await projectIn(tx, projectId);
  const working = await paperIn(tx, project);
  const raw = await get<{ recordVersion?: number }>(tx, 'plans', projectId);
  const record = raw?.recordVersion === 2 ? PlanRecordSchema.parse(raw) : undefined;
  if (record && record.projectId !== project.id) throw new ContentError('foreign-plan', '讲稿计划不属于当前项目。');
  const current = project.currentDeckId ? migrateDeckV1(await get(tx, 'decks', project.currentDeckId)) : undefined;
  if (current && current.id !== project.currentDeckId) throw new ContentError('foreign-deck', '当前稿身份不一致。');
  const previous = project.previousDeckId ? migrateDeckV1(await get(tx, 'decks', project.previousDeckId)) : undefined;
  if (previous && previous.id !== project.previousDeckId) throw new ContentError('foreign-deck', '上一版身份不一致。');
  const base = {
    projectPreferences: structuredClone(project.preferences),
    paperId: working.id,
    paperRevision: working.revision,
    figureReviewRevision: working.figureReview.revision,
    ...(current ? { current: { deckId: current.id, revision: current.revision } } : {}),
    ...(previous ? { previous: { deckId: previous.id, revision: previous.revision } } : {}),
  };
  let stale = false;
  if (record) {
    try {
      assertGenerationBase(record.base, project, working, current, previous);
    } catch {
      stale = true;
    }
  }
  // 生成后永远读取 Current 的唯一讲述，不能把消费后的计划当可写副本。
  if (current && !preferPlan) {
    const paper = await paperIn(tx, project, current.paperId);
    if (current.paperRevision !== undefined && current.paperRevision !== paper.revision)
      throw new ContentError('paper-version', '当前稿绑定的论文版本不一致。');
    const content = validateContent(
      {
        title: current.title,
        language: current.language,
        sections: current.sections.map((s) => ({ ...s, track: s.track ?? 'main' })),
        speechParagraphs: current.speechParagraphs ?? [],
        speech: current.speech ?? [],
        omissions: current.omissions ?? [],
      },
      paper,
    );
    validateSpeechAssignments(content, current.slides);
    return {
      project,
      paper,
      workingPaper: working,
      planKey: JSON.stringify(raw) ?? '',
      base,
      stale: false,
      legacyPlan: false,
      target: {
        kind: 'deck',
        id: current.id,
        revision: current.revision,
        content,
        assignments: Object.fromEntries(current.slides.map((slide) => [slide.id, [...(slide.speechIds ?? [])]])),
      },
    };
  }
  const paper = record ? await paperIn(tx, project, record.plan.paperId) : working;
  return {
    project,
    paper,
    workingPaper: working,
    planKey: JSON.stringify(raw) ?? '',
    record,
    base,
    stale,
    legacyPlan: !!raw && !record,
    target: record
      ? {
          kind: 'plan',
          id: record.plan.id,
          revision: record.plan.revision,
          content: validateContent(contentOf(record.plan), paper),
        }
      : undefined,
  };
}
const names = ['projects', 'papers', 'plans', 'decks', 'history'] as const;
export const speechStore: SpeechStore = {
  async open(id, preferPlan = false) {
    await openProject(id);
    return transaction([...names], 'readonly', (tx) => read(tx, id, preferPlan));
  },
  save(input) {
    return transaction([...names], 'readwrite', async (tx) => {
      input.assertActive();
      const state = await read(tx, input.projectId, input.target.kind === 'plan');
      if (
        !state.target ||
        state.stale ||
        state.target.kind !== input.target.kind ||
        state.target.id !== input.target.id ||
        state.target.revision !== input.target.revision
      )
        throw new ContentError('stale-target', '讲稿版本或编辑对象已变化，请重新打开。');
      if (await get(tx, 'history', input.requestId)) throw new ContentError('duplicate-request', '本次修改已保存。');
      const content = validateContent(input.content, state.paper);
      const updatedAt = Date.now();
      const revision = state.target.revision + 1;
      const affectedSlideIds: string[] = [];
      if (state.target.kind === 'plan') {
        const record = PlanRecordSchema.parse({
          ...state.record,
          stage: 'outline-ready',
          plan: { ...state.record!.plan, ...content, slides: [], revision, status: 'draft', updatedAt },
        });
        tx.objectStore('plans').put(record, state.project.id);
      } else {
        const deck = migrateDeckV1(await get(tx, 'decks', state.target.id));
        const sectionIds = new Set(content.sections.map((s) => s.id));
        if (deck.slides.some((slide) => !sectionIds.has(slide.sectionId)))
          throw new ContentError('section-has-slides', '该章节仍有幻灯片，请保留章节或先在幻灯片中处理页面。');
        const speechIds = new Set(content.speech.map((s) => s.id));
        const assignments = input.restoreAssignments;
        if (
          assignments &&
          (Object.keys(assignments).length !== deck.slides.length ||
            deck.slides.some((slide) => !Object.hasOwn(assignments, slide.id)))
        )
          throw new ContentError('stale-assignment', '页面已变化，不能恢复旧讲稿分配。');
        const slides = deck.slides.map((slide) => ({
          ...slide,
          speechIds: assignments ? assignments[slide.id] : (slide.speechIds ?? []).filter((id) => speechIds.has(id)),
        }));
        validateSpeechAssignments(content, slides);
        const before = new Map((deck.speech ?? []).map((segment) => [segment.id, JSON.stringify(segment)]));
        const changed = new Set(
          content.speech
            .filter((segment) => before.get(segment.id) !== JSON.stringify(segment))
            .map((segment) => segment.id),
        );
        slides.forEach((slide, index) => {
          if (
            JSON.stringify(slide.speechIds) !== JSON.stringify(deck.slides[index].speechIds ?? []) ||
            slide.speechIds.some((id) => changed.has(id))
          )
            affectedSlideIds.push(slide.id);
        });
        tx.objectStore('decks').put(
          {
            ...deck,
            ...content,
            schemaVersion: 3,
            paperRevision: deck.paperRevision ?? state.paper.revision,
            revision,
            updatedAt,
            slides,
          },
          deck.id,
        );
      }
      input.assertActive();
      tx.objectStore('projects').put({ ...state.project, updatedAt }, state.project.id);
      tx.objectStore('history').put(
        {
          id: input.requestId,
          projectId: state.project.id,
          ...(state.target.kind === 'plan'
            ? { kind: 'plan-revision', planId: state.target.id }
            : { deckId: state.target.id, scope: { type: 'deck' }, affectedSlideIds }),
          summary: '编辑大纲与演讲稿',
          createdAt: updatedAt,
          baseRevision: state.target.revision,
          committedRevision: revision,
        },
        input.requestId,
      );
      await trimHistory(tx, state.project.id);
      return read(tx, input.projectId, input.target.kind === 'plan');
    });
  },
  saveGenerated(input) {
    return transaction(
      [...names],
      'readwrite',
      async (tx) => {
        input.assertActive();
        const record = PlanRecordSchema.parse(input.record);
        const state = await read(tx, record.projectId);
        const current = state.project.currentDeckId
          ? migrateDeckV1(await get(tx, 'decks', state.project.currentDeckId))
          : undefined;
        const previous = state.project.previousDeckId
          ? migrateDeckV1(await get(tx, 'decks', state.project.previousDeckId))
          : undefined;
        const paper = await paperIn(tx, state.project);
        assertGenerationBase(record.base, state.project, paper, current, previous);
        const key = JSON.stringify(await get(tx, 'plans', record.projectId)) ?? '';
        if (key !== input.expectedPlan) throw new ContentError('stale-plan', '生成期间计划已改变，旧结果未覆盖。');
        validateContent(contentOf(record.plan), paper);
        if (record.plan.paperId !== paper.id || record.plan.paperRevision !== paper.revision)
          throw new ContentError('foreign-paper', '讲稿的论文版本不一致。');
        input.assertActive();
        await request(tx.objectStore('plans').put(record, record.projectId));
        tx.objectStore('projects').put(
          { ...state.project, checkpoint: current ? 'deck-ready' : 'outline-ready', updatedAt: Date.now() },
          record.projectId,
        );
        return read(tx, record.projectId);
      },
      input.signal,
    );
  },
};
