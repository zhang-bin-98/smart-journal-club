import { createProject, deleteProject, loadProject, saveStage } from '../src/modules/project/projectRepository';
import { createReanalysisProject, saveReanalysis } from '../src/modules/project/reanalysisRepository';
import { get, request, transaction } from '../src/shared/persistence/indexedDb';
import { OutlineSession } from '../src/modules/outline/OutlineSession';
import { savePlanRevision } from '../src/modules/outline/outlineRepository';
import { mapUnderstanding } from '../src/modules/paper/analysis';
import { fixturePaper } from './fixtures';
import { understanding } from './analysis-contracts';
import { fixedOutline, fixedSlides } from './generation-contracts';
import { assembleDeck } from '../src/modules/generation/buildDeck';
import { captureVersion, commitRegeneration } from '../src/modules/deck/deckRepository';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
async function rejected(work: () => Promise<unknown>) {
  try {
    await work();
  } catch {
    return;
  }
  throw new Error('重新分析应被拒绝');
}

export async function runReanalysisContracts() {
  const signal = new AbortController().signal;
  let project = await createProject(new File(['%PDF-reanalysis'], 'reanalysis.pdf'));
  const paper = { ...structuredClone(fixturePaper), id: project.paperId };
  try {
    project = await saveStage(project, { checkpoint: 'pdf-parsed', paper }, signal);
    project = await saveStage(project, { checkpoint: 'figures-ready', paper }, signal);
    project = await saveStage(project, { checkpoint: 'paper-ready', paper, strategyId: 'general' }, signal);
    let captured = await loadProject(project.id);
    const first = mapUnderstanding(paper, understanding(paper));
    await saveReanalysis({ captured, ...first, instruction: '新的理解要求', signal });
    let opened = await loadProject(project.id);
    assert(opened.project.checkpoint === 'paper-ready' && !opened.plan, '重新分析仍停在理解，不自动规划');
    assert(opened.paper.claims[0].id === first.paper.claims[0].id, '替换完整论文理解');
    assert(opened.project.preferences.instruction === '新的理解要求', '成功才保存要求');
    await rejected(() => saveReanalysis({ captured, ...first, instruction: '旧请求', signal }));
    project = await saveStage(
      opened.project,
      { checkpoint: 'deck-plan-ready', plan: fixedOutline(opened.paper) },
      signal,
    );
    captured = await loadProject(project.id);
    const session = new OutlineSession(captured.plan!, captured.paper, project.id, savePlanRevision);
    await session.confirm(session.capture(), { warningsAccepted: true });
    captured = await loadProject(project.id);
    const result = mapUnderstanding(captured.paper, understanding(captured.paper));
    const snapshot = JSON.stringify(captured);
    const save = (saveSignal = signal) =>
      saveReanalysis({ captured, ...result, instruction: '重新理解已确认计划', signal: saveSignal });
    const abort = new AbortController();
    abort.abort();
    await rejected(() => save(abort.signal));
    const changedSources = structuredClone(result.paper);
    changedSources.figures[0].description = '改变图源';
    await rejected(() => saveReanalysis({ captured, ...result, paper: changedSources, instruction: '', signal }));
    const wrongPaper = { ...result.paper, id: 'wrong-paper' };
    await rejected(() => saveReanalysis({ captured, ...result, paper: wrongPaper, instruction: '', signal }));
    assert(JSON.stringify(await loadProject(project.id)) === snapshot, '取消或非法结果保留确认计划与分析');
    for (const mode of ['quota', 'abort'] as const) {
      const original = IDBObjectStore.prototype.put;
      const during = new AbortController();
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'projects') {
          if (mode === 'quota') throw new DOMException('fixed quota', 'QuotaExceededError');
          during.abort();
        }
        return original.apply(this, args);
      };
      try {
        await rejected(() => save(during.signal));
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      assert(JSON.stringify(await loadProject(project.id)) === snapshot, '写入失败回滚 Paper、计划、项目偏好');
    }
    await session.commit({
      ...session.capture(),
      mutations: [{ type: 'update-section', sectionId: captured.plan!.sections[0].id, patch: { title: '并发修改' } }],
    });
    await session.undo();
    await session.confirm(session.capture(), { warningsAccepted: true });
    await rejected(() => save());
    captured = await loadProject(project.id);
    const asset = await transaction(['assets'], 'readonly', (tx) => get(tx, 'assets', project.pdfAssetId));
    await transaction(['assets'], 'readwrite', async (tx) => {
      tx.objectStore('assets').delete(project.pdfAssetId);
    });
    await rejected(() => save());
    await transaction(['assets'], 'readwrite', async (tx) => {
      tx.objectStore('assets').put(asset, project.pdfAssetId);
    });
    await save();
    opened = await loadProject(project.id);
    assert(opened.project.checkpoint === 'paper-ready' && !opened.planRecord, '成功清除已确认大纲并回到理解');
    assert(JSON.stringify(opened.paper.sources) === JSON.stringify(captured.paper.sources), '原始来源保持');
    assert(JSON.stringify(opened.paper.figures) === JSON.stringify(captured.paper.figures), '完整图源保持');
    assert((await opened.asset?.blob.text()) === '%PDF-reanalysis', 'PDF 内容保持');
    assert(JSON.stringify(opened) === JSON.stringify(await loadProject(project.id)), '刷新保持新理解且不规划');
    project = await saveStage(
      opened.project,
      { checkpoint: 'deck-plan-ready', plan: fixedOutline(opened.paper) },
      signal,
    );
    const planned = await loadProject(project.id);
    const finalSession = new OutlineSession(planned.plan!, planned.paper, project.id, savePlanRevision);
    const confirmed = await finalSession.confirm(finalSession.capture(), { warningsAccepted: true });
    const deck = assembleDeck(confirmed, fixedSlides(confirmed), planned.paper);
    project = await saveStage(
      project,
      { checkpoint: 'deck-ready', deck, strategyId: 'general', planId: confirmed.id, planRevision: confirmed.revision },
      signal,
    );
    const second = { ...structuredClone(deck), id: crypto.randomUUID() };
    await commitRegeneration(captureVersion(project, deck), second, project.preferences, signal);
    const originalData = JSON.stringify(await loadProject(project.id));
    const allStores = () =>
      transaction(['projects', 'papers', 'assets', 'decks', 'plans'], 'readonly', async (tx) => {
        const counts = [];
        for (const name of ['projects', 'papers', 'assets', 'decks', 'plans'])
          counts.push(await request(tx.objectStore(name).count()));
        return counts.join(',');
      });
    const counts = await allStores();
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'assets') throw new DOMException('fixed clone failure', 'QuotaExceededError');
      return originalAdd.apply(this, args);
    };
    try {
      await rejected(() => createReanalysisProject(project.id, '新要求', signal));
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    assert((await allStores()) === counts, '克隆失败不留下空项目或孤立 Paper');
    const cloned = await createReanalysisProject(project.id, '独立分析', signal);
    try {
      const copy = await loadProject(cloned.id);
      assert(copy.project.checkpoint === 'figures-ready' && !copy.deck && !copy.plan, '新项目只复用准备产物');
      assert(
        cloned.id !== project.id && cloned.paperId !== project.paperId && cloned.pdfAssetId !== project.pdfAssetId,
        '新项目使用独立身份',
      );
      assert(
        !copy.paper.claims.length &&
          !copy.paper.evidences.length &&
          !copy.paper.story &&
          !copy.paper.studyProfile &&
          !cloned.preferences.strategyId,
        '不复制旧理解与策略',
      );
      assert(cloned.preferences.instruction === '独立分析', '新要求仅存入独立项目');
      assert(JSON.stringify(copy.paper.figures) === JSON.stringify(opened.paper.figures), '新项目保留完整图源');
      assert((await copy.asset?.blob.text()) === '%PDF-reanalysis', '新项目保留原 PDF 内容');
      assert(JSON.stringify(await loadProject(project.id)) === originalData, '克隆不改变原项目和两版文稿');
      await deleteProject(cloned.id);
      assert(JSON.stringify(await loadProject(project.id)) === originalData, '删除副本不破坏原项目证据链');
    } finally {
      await deleteProject(cloned.id).catch(() => {});
    }
    return 'PASS: reanalysis paper-ready/confirmed plan/stale paper/edit-undo-reconfirm/invalid source/missing PDF/quota and abort rollback/atomic success';
  } finally {
    await deleteProject(project.id);
  }
}
