import { fixtureDeck } from './fixtures';
import { speechStore } from '../src/infrastructure/persistence/speechStore';
import { saveRequirements, createProject, openProject } from '../src/infrastructure/persistence/projectStore';
import { createOutlineSession } from '../src/app/presentation/OutlineSession';
import { transaction, get } from '../src/shared/persistence/indexedDb';
import { loadProject } from '../src/modules/project/projectRepository';
import { notesText } from '../src/modules/presentation/content';
import { DeckSession } from '../src/app/presentation/DeckSession';
function canonical(value: unknown): string {
  function order(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(order);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, order(v)]),
      );
    return item;
  }
  return JSON.stringify(order(value));
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejected(work: () => Promise<unknown>, message: string) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  check(failed, message);
}
export async function runSpeechStorageContracts(id: string) {
  let initial = await speechStore.open(id);
  let session = createOutlineSession(id, speechStore);
  await session.load();
  const paragraphId = initial.target!.content.speechParagraphs[0].id;
  await saveRequirements(id, { ...initial.project.preferences, instruction: '另一个窗口修改偏好' });
  await rejected(
    () => session.commit([{ type: 'update-paragraph', paragraphId, text: '旧请求不得保存' }]),
    '偏好改变后旧计划仍可写入',
  );
  await saveRequirements(id, initial.project.preferences);
  await session.load();
  const captured = await speechStore.open(id);
  await session.commit([{ type: 'update-paragraph', paragraphId, purpose: '最新人工目的' }]);
  await rejected(
    () =>
      speechStore.saveGenerated({
        record: captured.record!,
        expectedPlan: captured.planKey,
        assertActive() {},
        signal: new AbortController().signal,
      }),
    '旧生成覆盖新人工计划',
  );
  // 既有 Current 的历史入口使用单 PDF；双文件首次 Deck 构建属于 M18。
  const old = await openProject(id);
  const primary = old.paper.documents.find((document) => document.role === 'primary')!;
  const created = await createProject({
    primary: new File([old.assets[primary.id].blob], 'legacy-main.pdf', { type: 'application/pdf' }),
    preferences: initial.project.preferences,
  });
  const single = structuredClone(old.paper);
  single.id = created.paper.id;
  single.projectId = created.project.id;
  single.documents = [{ ...primary, pdfAssetId: created.paper.documents[0].pdfAssetId }];
  single.pages = single.pages.filter((p) => p.documentId === primary.id);
  single.blocks = single.blocks.filter((p) => p.documentId === primary.id);
  single.sources = single.sources.filter((s) => s.documentId === primary.id);
  single.figurePageSelections = single.figurePageSelections.filter((p) => p.documentId === primary.id);
  single.analysisUnits = single.analysisUnits.filter(
    (unit) => unit.target.kind !== 'page' || unit.target.documentId === primary.id,
  );
  const record = structuredClone((await speechStore.open(id)).record!);
  record.projectId = created.project.id;
  record.plan.paperId = single.id;
  record.base.paperId = single.id;
  await transaction(['projects', 'papers', 'plans'], 'readwrite', async (tx) => {
    tx.objectStore('papers').put(single, single.id);
    tx.objectStore('projects').put({ ...created.project, checkpoint: 'outline-ready' }, created.project.id);
    tx.objectStore('plans').put(record, created.project.id);
  });
  session.close();
  id = created.project.id;
  initial = await speechStore.open(id);
  session = createOutlineSession(id, speechStore);
  await session.load();
  const planBefore = await transaction(['plans'], 'readonly', async (tx) => JSON.stringify(await get(tx, 'plans', id)));
  const content = (await speechStore.open(id)).target!.content;
  const deck = structuredClone(fixtureDeck);
  deck.id = 'm17-current-' + id;
  deck.paperId = initial.paper.id;
  deck.sections = deck.sections.map((section) => ({ ...section, track: 'main' }));
  deck.speechParagraphs = content.speechParagraphs.map((p) => ({ ...p, sectionId: deck.sections[0].id }));
  deck.speech = content.speech;
  deck.omissions = content.omissions;
  deck.slides = deck.slides.map((slide, index) => ({
    ...slide,
    speechIds: index === 0 ? [...content.speechParagraphs[0].segmentIds] : [],
  }));
  await transaction(['projects', 'decks'], 'readwrite', async (tx) => {
    tx.objectStore('decks').put(deck, deck.id);
    tx.objectStore('projects').put({ ...initial.project, currentDeckId: deck.id, checkpoint: 'deck-ready' }, id);
  });
  await rejected(
    () => session.commit([{ type: 'update-paragraph', paragraphId, text: '不应回写旧 Plan' }]),
    'Plan/Deck 切换未拒绝旧请求',
  );
  await session.load();
  check(session.snapshot().data!.target!.kind === 'deck', '未绑定 Current');
  await session.commit([{ type: 'update-paragraph', paragraphId, text: '当前稿唯一讲述已更新。' }]);
  const stored = await transaction(['decks'], 'readonly', (tx) => get<typeof deck>(tx, 'decks', deck.id));
  check(canonical(stored!.slides) === canonical(deck.slides), '大纲编辑改变页面文字或图组');
  check(stored!.schemaVersion === 3, 'Current 未按讲述版本升级');
  check(notesText(stored!.speech!, stored!.slides[0].speechIds!) === '当前稿唯一讲述已更新。', '备注没有来自唯一正文');
  check(
    planBefore === (await transaction(['plans'], 'readonly', async (tx) => JSON.stringify(await get(tx, 'plans', id)))),
    '编辑 Current 回写了工作计划',
  );
  await session.commit([{ type: 'delete-paragraph', paragraphId }]);
  const deleted = await transaction(['decks'], 'readonly', (tx) => get<typeof deck>(tx, 'decks', deck.id));
  check(deleted!.slides[0].speechIds!.length === 0, '删除讲述留下悬空页面分配');
  await session.undo();
  const restored = await transaction(['decks'], 'readonly', (tx) => get<typeof deck>(tx, 'decks', deck.id));
  check(canonical(restored!.slides) === canonical(stored!.slides), '讲述撤销未恢复页面分配');
  check(
    notesText(restored!.speech!, restored!.slides[0].speechIds!) === '当前稿唯一讲述已更新。',
    '讲述撤销未恢复备注',
  );
  await session.redo();
  check(session.snapshot().data!.target!.assignments![deck.slides[0].id].length === 0, '讲述重做未清除分配');
  await session.undo();
  const legacy = await loadProject(id);
  check(legacy.deck?.id === deck.id, '旧编辑器不能读取扩展讲稿');
  const editing = new DeckSession(legacy.deck!, legacy.paper);
  await editing.commit(
    { type: 'deck' },
    [{ type: 'delete-slide', slideId: editing.current.slides[0].id }],
    '删除页面保留讲述',
  );
  check(editing.current.speech?.length === deck.speech.length, '删页丢失讲稿');
  await editing.undo();
  check(canonical(editing.current.slides) === canonical(stored!.slides), '撤销未恢复原分配');
  session.close();
  return {
    preferencesConflict: true,
    staleGeneration: true,
    targetSwitch: true,
    currentSpeech: true,
    notes: true,
    legacyEditor: true,
  };
}
