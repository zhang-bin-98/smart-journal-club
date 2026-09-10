import { DEFAULT_SETTINGS } from '../src/app/settings/modelSettings';
import { commitUnit, ensureWorkingPaper, setPageSelection } from '../src/infrastructure/persistence/paperStore';
import {
  createProject,
  deleteProject,
  listProjects,
  openProject,
  openStep,
} from '../src/infrastructure/persistence/projectStore';
import { loadHistory, saveConversation } from '../src/modules/assistant/conversationRepository';
import { captureVersion, restorePrevious } from '../src/modules/deck/deckRepository';
import { discardCandidate } from '../src/modules/generation/candidateRepository';
import { preparePaper as prepareLegacyPaper } from '../src/modules/generation/runGeneration';
import { getUnitInputKey } from '../src/modules/paper/analysisUnits';
import type { Paper } from '../src/modules/paper/model';
import { loadProject, updateProject } from '../src/modules/project/projectRepository';
import type { PdfResource } from '../src/shared/pdf/pdfResource';
import { get, transaction } from '../src/shared/persistence/indexedDb';
import { fixtureDeck, fixturePaper } from './fixtures';
import { legacyProject } from './legacy-fixtures';
import { narrativePlan } from './narrative-fixture';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
async function rejects(work: () => Promise<unknown>, message: string) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed, message);
}
const pdf = (name: string) => new File(['%PDF-1.7 fixture'], name, { type: 'application/pdf' });
const read = <T>(store: 'projects' | 'papers' | 'decks' | 'assets', id: string) =>
  transaction([store], 'readonly', (tx) => get<T>(tx, store, id));

export async function runM15PersistenceContracts() {
  const startCount = (await listProjects()).length;
  const add = IDBObjectStore.prototype.add;
  let assetWrites = 0;
  IDBObjectStore.prototype.add = function (value, key) {
    if (this.name === 'assets' && ++assetWrites === 2) throw new DOMException('fixture quota', 'QuotaExceededError');
    return add.call(this, value, key);
  };
  try {
    await rejects(
      () => createProject({ primary: pdf('main.pdf'), supplement: pdf('supplement.pdf') }),
      '第二份文件保存失败应回滚项目',
    );
  } finally {
    IDBObjectStore.prototype.add = add;
  }
  assert((await listProjects()).length === startCount, '创建失败留下半项目');

  const created = await createProject({ primary: pdf('main.pdf'), supplement: pdf('supplement.pdf') });
  const id = created.project.id;
  try {
    const signal = new AbortController().signal;
    const [primary, supplement] = created.paper.documents;
    const target = (documentId: string) => ({ kind: 'page' as const, documentId, pageNumber: 1 });
    const saveText = (documentId: string, text: string) =>
      commitUnit({
        projectId: id,
        paperId: created.paper.id,
        stage: 'text',
        target: target(documentId),
        inputKey: getUnitInputKey(created.paper, 'text', target(documentId)),
        result: {
          width: 800,
          height: 600,
          pageCount: 1,
          blocks: [{ id: `block:${documentId}`, kind: 'paragraph', text }],
        },
        signal,
      });
    await Promise.all([saveText(supplement.id, 'Supplement sentence.'), saveText(primary.id, 'Primary sentence.')]);
    let opened = await openProject(id);
    assert(opened.paper.pages.length === 2 && opened.paper.analysisUnits.length === 2, '兄弟单元乱序提交丢失');
    assert(
      opened.paper.blocks.some((block) => block.documentId === supplement.id && block.text === 'Supplement sentence.'),
      '同页码跨文件串用',
    );
    const selection = opened.paper.figurePageSelections.find((item) => item.documentId === primary.id)!;
    const oldKey = getUnitInputKey(opened.paper, 'figure-location', target(primary.id));
    await setPageSelection({
      projectId: id,
      documentId: primary.id,
      pageNumber: 1,
      manualOverride: 'include',
      expectedRevision: selection.revision,
    });
    await rejects(
      () =>
        commitUnit({
          projectId: id,
          paperId: opened.paper.id,
          stage: 'figure-location',
          target: target(primary.id),
          inputKey: oldKey,
          result: { figures: [], sources: [] },
          signal,
        }),
      '人工选择后迟到结果必须拒绝',
    );
    opened = await openProject(id);
    const canceled = new AbortController();
    canceled.abort();
    await rejects(
      () =>
        commitUnit({
          projectId: id,
          paperId: opened.paper.id,
          stage: 'figure-discovery',
          target: target(primary.id),
          inputKey: getUnitInputKey(opened.paper, 'figure-discovery', target(primary.id)),
          result: { automatic: 'detected' },
          signal: canceled.signal,
        }),
      '取消不能写入完成记录',
    );
    assert((await openProject(id)).paper.analysisUnits.length === 2, '取消产生假完成');
    const snapshot = JSON.stringify(opened.paper);
    await openStep(id, 'paper-analysis');
    assert(JSON.stringify((await openProject(id)).paper) === snapshot, '浏览改变底稿内容');
  } finally {
    await deleteProject(id);
  }

  const oldId = crypto.randomUUID();
  const oldPaper = { ...structuredClone(fixturePaper), id: crypto.randomUUID() };
  const current = { ...structuredClone(fixtureDeck), id: crypto.randomUUID(), paperId: oldPaper.id };
  const previous = { ...structuredClone(fixtureDeck), id: crypto.randomUUID(), paperId: oldPaper.id };
  const legacy = legacyProject({
    id: oldId,
    paperId: oldPaper.id,
    pdfAssetId: crypto.randomUUID(),
    checkpoint: 'deck-ready',
    currentDeckId: current.id,
    previousDeckId: previous.id,
  });
  await transaction(['projects', 'papers', 'assets', 'decks'], 'readwrite', async (tx) => {
    tx.objectStore('projects').put(legacy, oldId);
    tx.objectStore('papers').put(oldPaper, oldPaper.id);
    tx.objectStore('assets').put({ blob: pdf('old.pdf'), name: 'old.pdf' }, legacy.pdfAssetId);
    tx.objectStore('decks').put(current, current.id);
    tx.objectStore('decks').put(previous, previous.id);
  });
  try {
    const listed = (await listProjects()).find((item) => item.project.id === oldId)!;
    assert(listed.project.schemaVersion === 2 && listed.paper.schemaVersion === 2, '列表不能读取旧项目');
    assert((await read<{ schemaVersion: number }>('projects', oldId))?.schemaVersion === 1, '列表查询写入了迁移');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'projects' && key === oldId) throw new DOMException('fixture quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    try {
      await rejects(() => openProject(oldId), '迁移写入失败应回滚全部记录');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert((await read<{ schemaVersion: number }>('papers', oldPaper.id))?.schemaVersion === 1, '迁移失败修改了底稿');
    const upgraded = await openProject(oldId);
    const again = await openProject(oldId);
    assert(JSON.stringify(upgraded) === JSON.stringify(again), '迁移不幂等');
    assert(upgraded.paper.figures[0].regions[0].sourceId === fixturePaper.figures[0].sourceId, '迁移丢失旧图源身份');
    const previousPaper = {
      ...structuredClone(upgraded.paper),
      id: crypto.randomUUID(),
      metadata: { ...upgraded.paper.metadata, title: 'previous evidence binding' },
    };
    previous.paperId = previousPaper.id;
    await transaction(['papers', 'decks'], 'readwrite', async (tx) => {
      tx.objectStore('papers').put(previousPaper, previousPaper.id);
      tx.objectStore('decks').put(previous, previous.id);
    });
    const frozen = JSON.stringify(upgraded.paper);
    const working = await ensureWorkingPaper(oldId);
    assert(working.paper.id !== upgraded.paper.id, '有旧稿的底稿未复制');
    assert(JSON.stringify(await read<Paper>('papers', oldPaper.id)) === frozen, '工作复制修改旧稿底稿');
    const target = { kind: 'page' as const, documentId: working.paper.documents[0].id, pageNumber: 1 };
    const replacement = {
      ...working.paper.sources[0],
      id: 'replacement-source',
      geometryOrigin: 'automatic' as const,
    };
    const relocalized = await commitUnit({
      projectId: oldId,
      paperId: working.paper.id,
      stage: 'figure-location',
      target,
      inputKey: getUnitInputKey(working.paper, 'figure-location', target),
      result: {
        sources: [replacement],
        figures: [
          {
            id: 'replacement-figure',
            label: 'Figure 3',
            regions: [{ id: 'replacement-region', sourceId: replacement.id, panels: [] }],
          },
        ],
      },
      signal: new AbortController().signal,
    });
    assert(!relocalized.paper.evidences.length && !relocalized.paper.claims.length, '旧来源派生证据未失效');
    assert(!relocalized.paper.story && !relocalized.paper.studyProfile, '旧汇总仍引用已移除来源');
    assert(JSON.stringify(await read<Paper>('papers', oldPaper.id)) === frozen, '重定位修改了旧稿底稿');
    const prefix = `finding:${target.documentId}:1:`;
    const repaired = await commitUnit({
      projectId: oldId,
      paperId: relocalized.paper.id,
      stage: 'evidence',
      target,
      inputKey: getUnitInputKey(relocalized.paper, 'evidence', target),
      result: {
        claims: [{ ...fixturePaper.claims[0], id: `${prefix}claim`, evidenceIds: [`${prefix}evidence`] }],
        evidences: [{ ...fixturePaper.evidences[0], id: `${prefix}evidence`, sourceIds: [replacement.id] }],
      },
      signal: new AbortController().signal,
    });
    assert(repaired.paper.evidences[0].sourceIds[0] === replacement.id, '迁移后本页证据无法续跑补全');
    const legacyOpened = await loadProject(oldId);
    assert(legacyOpened.paper.id === current.paperId, '旧稿打开使用了工作底稿');
    assert(legacyOpened.legacyGenerationAllowed === false, '升级后的旧稿仍启用了单文件生成入口');
    let accessedLegacyResource = false;
    let legacyErrorCode = '';
    const forbiddenResource = new Proxy({} as PdfResource, {
      get() {
        accessedLegacyResource = true;
        throw new Error('legacy resource accessed');
      },
    });
    try {
      await prepareLegacyPaper(
        { ...legacyOpened, project: { ...legacyOpened.project, checkpoint: 'project-created' } },
        forbiddenResource,
        DEFAULT_SETTINGS,
        new AbortController().signal,
      );
    } catch (cause) {
      legacyErrorCode = (cause as { code?: string }).code ?? '';
    }
    assert(
      legacyErrorCode === 'legacy-generation-disabled' && !accessedLegacyResource,
      'v2 项目必须在读取旧资源或模型调用前拒绝旧流程',
    );
    assert((await read<{ schemaVersion: number }>('projects', oldId))?.schemaVersion === 2, '旧流程降写了升级项目');
    const savedPlan = { ...narrativePlan(), paperId: oldPaper.id, id: crypto.randomUUID() };
    await transaction(['plans'], 'readwrite', async (tx) => {
      tx.objectStore('plans').put(
        {
          recordVersion: 1,
          projectId: oldId,
          mode: 'regeneration',
          plan: savedPlan,
          preferences: legacy.preferences,
          base: {
            current: { deckId: current.id, revision: current.revision },
            previous: { deckId: previous.id, revision: previous.revision },
          },
        },
        oldId,
      );
    });
    const restored = await restorePrevious(captureVersion(legacyOpened.project, legacyOpened.deck!));
    assert(restored.deck.id === previous.id, '旧稿恢复失败');
    assert((await read<{ schemaVersion: number }>('projects', oldId))?.schemaVersion === 2, '旧稿恢复降写项目版本');
    assert((await openProject(oldId)).project.paperId === working.paper.id, '旧稿恢复覆盖了工作底稿');
    const restoredView = await loadProject(oldId);
    assert(
      restoredView.paper.id === previousPaper.id && restoredView.paper.metadata.title === 'previous evidence binding',
      '恢复上一版没有读取其自己的证据',
    );
    assert(
      restoredView.candidateStale && restoredView.planPaper?.id === oldPaper.id,
      '旧计划不能阻断已恢复稿件或混用其论文依据',
    );
    await discardCandidate(oldId, savedPlan.id, savedPlan.revision);
    assert(!(await loadProject(oldId)).plan, '升级项目的旧计划无法显式放弃');
    await updateProject(oldId, { lastOpenedSlideId: restored.deck.slides[1].id });
    await saveConversation(oldId, [
      {
        id: crypto.randomUUID(),
        projectId: oldId,
        deckId: restored.deck.id,
        baseRevision: restored.deck.revision,
        role: 'user',
        text: 'fixture history',
        createdAt: Date.now(),
      },
    ]);
    assert((await loadHistory(oldId)).length === 1, '升级项目的旧稿对话历史不可用');
    assert((await read<{ schemaVersion: number }>('projects', oldId))?.schemaVersion === 2, '旧稿位置保存降写项目');

    const sharedProject = legacyProject({
      id: crypto.randomUUID(),
      paperId: crypto.randomUUID(),
      pdfAssetId: legacy.pdfAssetId,
      checkpoint: 'paper-ready',
    });
    await transaction(['projects', 'papers'], 'readwrite', async (tx) => {
      tx.objectStore('projects').put(sharedProject, sharedProject.id);
      tx.objectStore('papers').put({ ...oldPaper, id: sharedProject.paperId }, sharedProject.paperId);
    });
    try {
      await rejects(() => deleteProject(oldId), '不能删除尚未迁移项目引用的资产');
      assert(await read('assets', legacy.pdfAssetId), '跨项目资源删除失败仍丢失资产');
      assert(await read('projects', oldId), '跨项目资源删除失败仍丢失项目');
    } finally {
      await transaction(['projects', 'papers'], 'readwrite', async (tx) => {
        tx.objectStore('projects').delete(sharedProject.id);
        tx.objectStore('papers').delete(sharedProject.paperId);
      });
    }

    const foreign = await createProject({ primary: pdf('foreign.pdf') });
    try {
      await transaction(['decks'], 'readwrite', async (tx) => {
        tx.objectStore('decks').put({ ...current, paperId: foreign.paper.id }, current.id);
      });
      await rejects(() => openProject(oldId), '跨项目底稿必须拒绝');
      await transaction(['decks'], 'readwrite', async (tx) => {
        tx.objectStore('decks').put(current, current.id);
      });
    } finally {
      await deleteProject(foreign.project.id);
    }
  } finally {
    await deleteProject(oldId);
  }
  assert(
    !(await read('papers', oldPaper.id)) && !(await read('assets', legacy.pdfAssetId)),
    '删除项目未回收冻结底稿与资产',
  );
  return 'PASS: M15 双文件事务、乱序单元、取消/人工覆盖、迁移回滚/幂等、冻结底稿、旧稿恢复和归属';
}
