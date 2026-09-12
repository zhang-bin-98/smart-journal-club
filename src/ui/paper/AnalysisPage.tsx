import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, Pause, Play, Settings, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { isSelected, unitComplete } from '../../modules/paper/analysisUnits';
import { Brand, Button, IconButton, inputClass } from '../controls';
import { ProjectDialog } from '../projects/ProjectDialog';
import { AppHeaderActions } from '../PwaNotice';
import { PagePreview, WorkspaceDivider } from './PagePreview';
import { PaperAssistant } from './PaperAssistant';
import { type PageFilter, pageProcessingLabel, pageSelectionLabel, usePaperAnalysis } from './usePaperAnalysis';

export function AnalysisPage({
  id,
  settings,
  onSettings,
  onLeave,
  onLegacyStep,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  onSettings: () => void;
  onLeave: () => void;
  onLegacyStep?: (step: 'slides' | 'outline-speech' | 'figure-review') => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const controller = usePaperAnalysis({ id, settings, registerLeaveGuard, onLegacyStep });
  const { paper, snapshot, progress, selectedPage } = controller;
  const [leftWidth, setLeftWidth] = useState(230);
  const [rightWidth, setRightWidth] = useState(350);
  const [aiOpen, setAiOpen] = useState(false);
  if (!paper || !snapshot.data)
    return (
      <main className="p-6">
        <Button onClick={onLeave}>
          <ArrowLeft size={16} />
          返回项目
        </Button>
        <p role={controller.error ? 'alert' : 'status'} className="mt-8 text-sm">
          {controller.error || '正在读取论文项目…'}
        </p>
        {controller.error && (
          <Button className="mt-4" onClick={() => void controller.reload()}>
            重试读取
          </Button>
        )}
      </main>
    );
  const project = snapshot.data.project;
  const selection =
    selectedPage &&
    paper.figurePageSelections.find(
      (page) => page.documentId === selectedPage.documentId && page.pageNumber === selectedPage.pageNumber,
    );
  const selectedDocument = paper.documents.find((document) => document.id === selectedPage?.documentId);
  const selected = selection ? isSelected(selection) : false;
  const running = snapshot.status === 'running';
  const waiting = running && controller.scheduler.waitingUntil > Date.now();
  const visibleDocuments = paper.documents.filter(
    (document) => controller.documentFilter === 'all' || document.id === controller.documentFilter,
  );
  const selectedCount = paper.figurePageSelections.filter(isSelected).length;
  const manualCount = paper.figurePageSelections.filter((page) => page.manualOverride === 'include').length;
  const autoCount = paper.figurePageSelections.filter((page) => page.automatic === 'detected').length;
  const pendingCount = paper.figurePageSelections.filter(
    (page) =>
      isSelected(page) &&
      !unitComplete(paper, 'figure-location', {
        kind: 'page',
        documentId: page.documentId,
        pageNumber: page.pageNumber,
      }),
  ).length;
  const ready = progress?.ready ?? false;
  const runLabel = snapshot.status === 'failed' ? '重试未完成部分' : progress?.completed ? '继续分析' : '开始分析';
  const taskLabel = waiting
    ? '正在等待模型服务恢复'
    : running
      ? snapshot.stage
      : ready
        ? '分析就绪，等待进入图源核对'
        : snapshot.status === 'paused'
          ? '已暂停，已保存内容保留'
          : snapshot.status === 'cancelled'
            ? '已取消，已保存内容保留'
            : snapshot.status === 'failed'
              ? '分析失败，可继续未完成部分'
              : progress?.completed
                ? '待继续，已恢复保存内容'
                : '待分析';
  const previewRegions = selectedPage
    ? paper.sources.flatMap((source) => {
        if (
          !source.bbox ||
          source.documentId !== selectedPage.documentId ||
          source.pageNumber !== selectedPage.pageNumber ||
          !['figure', 'panel'].includes(source.kind)
        )
          return [];
        const figure = paper.figures.find((item) =>
          item.regions.some(
            (region) => region.sourceId === source.id || region.panels.some((panel) => panel.sourceId === source.id),
          ),
        );
        const panel = figure?.regions.flatMap((region) => region.panels).find((item) => item.sourceId === source.id);
        return [
          {
            id: source.id,
            bbox: source.bbox,
            label: [figure?.label || 'Figure', panel?.label].filter(Boolean).join(' '),
            panel: source.kind === 'panel',
          },
        ];
      })
    : [];
  const elapsedSeconds = Math.floor(controller.elapsedMs / 1000);
  const shownGroups = visibleDocuments.map((document) => ({
    document,
    pages: Array.from({ length: document.pageCount ?? 0 }, (_, index) => ({
      documentId: document.id,
      pageNumber: index + 1,
    })).filter((target) => {
      const entry = paper.figurePageSelections.find(
        (page) => page.documentId === target.documentId && page.pageNumber === target.pageNumber,
      );
      if (controller.pageFilter === 'selected') return !!entry && isSelected(entry);
      if (controller.pageFilter === 'unselected') return !entry || !isSelected(entry);
      if (controller.pageFilter === 'pending') return pageProcessingLabel(paper, target) !== '已保存';
      return true;
    }),
  }));
  const visibleCount = shownGroups.reduce((sum, group) => sum + group.pages.length, 0);
  async function leave() {
    try {
      await controller.saveRequirements();
      onLeave();
    } catch (cause) {
      controller.setError(cause instanceof Error ? cause.message : '汇报要求保存失败。');
    }
  }
  async function settingsPage() {
    try {
      await controller.saveRequirements();
      onSettings();
    } catch (cause) {
      controller.setError(cause instanceof Error ? cause.message : '汇报要求保存失败。');
    }
  }
  return (
    <div className="flex h-dvh min-w-[1100px] flex-col overflow-hidden bg-canvas text-sm text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton label="返回项目列表" onClick={() => void leave()}>
            <ArrowLeft size={16} />
          </IconButton>
          <Brand />
          <span title={project.name} className="max-w-44 truncate text-xs text-muted">
            {project.name}
          </span>
        </div>
        <nav aria-label="项目步骤" className="flex shrink-0 items-center gap-2">
          <Button primary onClick={() => void controller.navigate('paper-analysis')}>
            1 论文分析
          </Button>
          <span className="text-muted">›</span>
          <Button primary={false} disabled={!ready} onClick={() => void controller.navigate('figure-review')}>
            2 图源核对
          </Button>
          <span className="text-muted">›</span>
          <Button
            disabled={!onLegacyStep || !['outline-ready', 'deck-plan-ready', 'deck-ready'].includes(project.checkpoint)}
            onClick={() => void controller.navigate('outline-speech')}
          >
            3 大纲与讲稿
          </Button>
          <span className="text-muted">›</span>
          <Button disabled={!onLegacyStep || !project.currentDeckId} onClick={() => void controller.navigate('slides')}>
            4 幻灯片
          </Button>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <AppHeaderActions />
          <IconButton label="模型设置" onClick={() => void settingsPage()}>
            <Settings size={16} />
          </IconButton>
        </div>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="font-medium">论文分析</h1>
          <p role="status" className="mt-1 truncate text-xs text-muted">
            {taskLabel}
            {snapshot.documentId
              ? ` · ${paper.documents.find((document) => document.id === snapshot.documentId)?.fileName ?? '当前文件'}${snapshot.pageNumber ? ` · 第 ${snapshot.pageNumber} 页` : ''}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {running ? (
            <Button onClick={controller.session.pause}>
              <Pause size={15} />
              暂停分析
            </Button>
          ) : !ready ? (
            <Button primary disabled={!settings.apiKey.trim()} onClick={() => void controller.start()}>
              <Play size={15} />
              {runLabel}
            </Button>
          ) : (
            <Button
              primary
              disabled={controller.saving || controller.selectionSaving}
              onClick={() => void controller.navigate('figure-review')}
            >
              下一步：图源核对
              <ArrowRight size={15} />
            </Button>
          )}
          <Button onClick={() => setAiOpen(!aiOpen)}>
            <Sparkles size={15} />
            {aiOpen ? '收起 AI' : 'AI 问答'}
          </Button>
        </div>
      </div>
      {(controller.error || snapshot.error) && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-xs text-red-800"
        >
          <span>{controller.error || snapshot.error}</span>
          {controller.failedSelection ? (
            <div className="flex shrink-0 gap-2">
              <Button disabled={controller.selectionSaving} onClick={controller.retrySelection}>
                重试保存选择
              </Button>
              <Button disabled={controller.selectionSaving} onClick={controller.discardSelection}>
                撤销未保存选择
              </Button>
            </div>
          ) : controller.error ? (
            <Button onClick={() => controller.setError('')}>关闭提示</Button>
          ) : (
            <Button disabled={running} onClick={() => void controller.start()}>
              重试分析
            </Button>
          )}
        </div>
      )}
      <main className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col bg-white" style={{ width: leftWidth }}>
          <div className="shrink-0 border-b border-line p-4">
            <h2 className="font-medium">材料与进度</h2>
            <Button className="mt-3 w-full justify-start" onClick={() => controller.setDocumentFilter('all')}>
              <FileText size={14} />
              全部材料
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {progress?.documents.map((document) => (
              <button
                key={document.id}
                className={`mb-4 block w-full cursor-pointer rounded border p-3 text-left focus-visible:outline-2 focus-visible:outline-focus ${controller.documentFilter === document.id ? 'border-accent bg-accent/5' : 'border-line bg-panel'}`}
                onClick={() => controller.setDocumentFilter(document.id)}
              >
                <span className="text-xs font-medium">{document.role === 'primary' ? '主论文' : '补充材料'}</span>
                <span title={document.fileName} className="mt-1 block truncate text-xs text-muted">
                  {document.fileName}
                </span>
                <span className="mt-3 block text-xs leading-6 text-muted">
                  文本提取 {document.text}/{document.total ?? '—'} 页<br />
                  图页发现 {document.discovery}/{document.total ?? '—'} 页<br />
                  图源处理 {document.figures}/{document.selected} 页<br />
                  证据整理 {document.evidence}/{document.total ?? '—'} 页
                </span>
              </button>
            ))}
            <section className="border-t border-line pt-4">
              <label htmlFor="analysis-requirements" className="font-medium">
                汇报要求 <span className="text-xs font-normal text-muted">可选</span>
              </label>
              <textarea
                id="analysis-requirements"
                disabled={!controller.requirementsReady}
                rows={5}
                className={`${inputClass} mt-3 resize-y leading-relaxed`}
                value={controller.instruction}
                onChange={(event) => controller.changeInstruction(event.target.value)}
                onCompositionStart={controller.onCompositionStart}
                onCompositionEnd={controller.onCompositionEnd}
                onBlur={() => void controller.saveRequirements().catch(() => {})}
                aria-describedby="analysis-requirements-hint analysis-requirements-status"
                placeholder="例如：中文组会，重点讲实验设计与主要发现。"
              />
              <p id="analysis-requirements-hint" className="mt-2 text-xs leading-relaxed text-muted">
                修改后用于后续讲稿与幻灯片，不重新解析 PDF；已有成果保留。
              </p>
              <p
                id="analysis-requirements-status"
                role="status"
                className={`mt-2 text-xs ${controller.saveStatus.startsWith('保存失败') ? 'text-red-700' : 'text-muted'}`}
              >
                {controller.saveStatus}
              </p>
              {controller.saveStatus.startsWith('保存失败') && (
                <Button className="mt-2" onClick={() => void controller.saveRequirements().catch(() => {})}>
                  重试保存要求
                </Button>
              )}
            </section>
          </div>
          <div className="shrink-0 border-t border-line p-4 text-xs leading-relaxed">
            <p>{running ? '分析任务进行中' : ready ? '必需分析已保存' : '已保存单元可恢复'}</p>
            <p className="mt-2 text-muted">
              图源页 {selectedCount} · 待处理 {pendingCount}
            </p>
            <p className="mt-2 text-muted">
              已用 {Math.floor(elapsedSeconds / 60)} 分 {elapsedSeconds % 60} 秒
            </p>
            {running && controller.scheduler.queued > 0 && (
              <p role="status" className="mt-2 text-muted">
                模型请求排队中 · {controller.scheduler.queued} 个
                {waiting
                  ? `，约 ${Math.max(1, Math.ceil((controller.scheduler.waitingUntil - Date.now()) / 1000))} 秒后继续`
                  : ''}
              </p>
            )}
            {running && (
              <Button className="mt-3" onClick={controller.session.cancel}>
                取消本次运行
              </Button>
            )}
          </div>
        </aside>
        <WorkspaceDivider
          label="调整材料栏宽度"
          width={leftWidth}
          min={200}
          max={Math.min(320, Math.max(1100, window.innerWidth) - rightWidth - 332)}
          onChange={setLeftWidth}
        />
        <section className="flex min-w-[320px] flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3">
            <h2 className="shrink-0 font-medium">全部原文页面</h2>
            {
              <select
                aria-label="筛选原文页面"
                className={`${inputClass} max-w-36 shrink-0`}
                value={controller.pageFilter}
                onChange={(event) => controller.setPageFilter(event.target.value as PageFilter)}
              >
                <option value="all">全部页面</option>
                <option value="selected">图源页</option>
                <option value="unselected">未入选页</option>
                <option value="pending">待处理页</option>
              </select>
            }
          </div>
          <div
            ref={controller.list}
            onScroll={(event) => controller.rememberScroll(event.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            {!settings.apiKey.trim() && (
              <div className="mb-4 rounded border border-line bg-white p-4 text-xs">
                <p>论文和汇报要求已保存。配置模型后即可开始分析。</p>
                <Button className="mt-3" onClick={() => void settingsPage()}>
                  配置模型
                </Button>
              </div>
            )}
            {shownGroups.map(({ document, pages }) => (
              <section key={document.id} className="mb-7">
                <h3 className="mb-3 text-xs font-medium">
                  {document.role === 'primary' ? '主论文' : '补充材料'} ·{' '}
                  <span title={document.fileName}>{document.fileName}</span>{' '}
                  <span className="font-normal text-muted">
                    {document.pageCount === undefined ? '页数待解析' : `${document.pageCount} 页`}
                  </span>
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-4">
                  {pages.map((target) => {
                    const entry = paper.figurePageSelections.find(
                      (page) => page.documentId === target.documentId && page.pageNumber === target.pageNumber,
                    );
                    const focused =
                      selectedPage?.documentId === target.documentId && selectedPage.pageNumber === target.pageNumber;
                    return (
                      <article
                        key={target.pageNumber}
                        className={`overflow-hidden rounded border bg-white ${focused ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
                      >
                        <button
                          className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-focus"
                          aria-label={`预览${document.role === 'primary' ? '主论文' : '补充材料'}第 ${target.pageNumber} 页`}
                          onClick={() => controller.setSelectedPage(target)}
                        >
                          <PagePreview session={controller.session} {...target} thumbnail />
                        </button>
                        <div className="border-t border-line p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs">第 {target.pageNumber} 页</span>
                            <input
                              type="checkbox"
                              aria-label={`${document.role === 'primary' ? '主论文' : '补充材料'}第 ${target.pageNumber} 页作为图源页处理`}
                              checked={!!entry && isSelected(entry)}
                              disabled={!entry || controller.selectionSaving}
                              onChange={(event) =>
                                controller.select(target, event.target.checked ? 'include' : 'exclude')
                              }
                              className="size-4 accent-accent"
                            />
                          </div>
                          <p className="mt-2 text-[11px] text-muted">{pageSelectionLabel(entry)}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted">
                            {pageProcessingLabel(paper, target)}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!document.pageCount && (
                  <p className="rounded border border-dashed border-control bg-white px-4 py-8 text-center text-xs text-muted">
                    开始分析后显示该文件全部页面。
                  </p>
                )}
              </section>
            ))}
            {!visibleCount && paper.documents.some((document) => document.pageCount) && (
              <div className="p-8 text-center text-sm text-muted">
                <p>没有匹配的页面。</p>
                <Button
                  className="mt-3"
                  onClick={() => {
                    controller.setDocumentFilter('all');
                    controller.setPageFilter('all');
                  }}
                >
                  清除筛选
                </Button>
              </div>
            )}
          </div>
        </section>
        <WorkspaceDivider
          label="调整原页预览栏宽度"
          width={rightWidth}
          min={290}
          max={Math.min(520, Math.max(1100, window.innerWidth) - leftWidth - 332)}
          reverse
          onChange={setRightWidth}
        />
        <aside className="flex shrink-0 flex-col bg-white" style={{ width: rightWidth }}>
          <div className="shrink-0 border-b border-line p-4">
            <h2 className="font-medium">{selectedPage ? `原文预览 · 第 ${selectedPage.pageNumber} 页` : '原文预览'}</h2>
            <p title={selectedDocument?.fileName} className="mt-1 truncate text-xs text-muted">
              {selectedDocument
                ? `${selectedDocument.role === 'primary' ? '主论文' : '补充材料'} · ${selectedDocument.fileName}`
                : '选择页面查看原文'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedPage ? (
              <>
                <div className="overflow-hidden rounded border border-line">
                  <PagePreview session={controller.session} {...selectedPage} regions={previewRegions} />
                </div>
                <p className="mt-4 text-xs text-muted">
                  {pageSelectionLabel(selection)} · {pageProcessingLabel(paper, selectedPage)}
                </p>
                {
                  <>
                    <label className="mt-4 flex items-center gap-2 rounded border border-control p-3 text-xs">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selection || controller.selectionSaving}
                        onChange={(event) =>
                          controller.select(selectedPage, event.target.checked ? 'include' : 'exclude')
                        }
                        className="size-4 accent-accent"
                      />
                      作为图源页处理
                    </label>
                    <Button
                      className="mt-3"
                      disabled={!selection?.manualOverride || controller.selectionSaving}
                      onClick={() => controller.select(selectedPage)}
                    >
                      恢复自动选择
                    </Button>
                    <p className="mt-4 text-xs leading-relaxed text-muted">
                      {!selection
                        ? '该页文本提取完成后可调整图源选择。'
                        : '页级选择仅影响图源处理；正文、方法和图注仍完整提取。人工选择优先于自动发现结果。'}
                    </p>
                  </>
                }
                <details className="mt-5 border-t border-line pt-4">
                  <summary className="flex cursor-pointer items-center gap-2 text-xs">
                    <ChevronDown size={14} />
                    已提取原文
                  </summary>
                  <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted">
                    {paper.blocks
                      .filter(
                        (block) =>
                          block.documentId === selectedPage.documentId && block.pageNumber === selectedPage.pageNumber,
                      )
                      .map((block) => block.text)
                      .join('\n\n') || '该页原文尚未提取。'}
                  </div>
                </details>
              </>
            ) : (
              <p className="py-8 text-center text-xs text-muted">选择一页查看原文与图源处理状态。</p>
            )}
            {aiOpen && (
              <div className="mt-5 border-t border-line pt-4">
                <PaperAssistant
                  paper={paper}
                  documentId={selectedPage?.documentId}
                  pageNumber={selectedPage?.pageNumber}
                  settings={settings}
                />
              </div>
            )}
          </div>
        </aside>
      </main>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-white px-5 py-2.5 text-xs text-muted">
        <span>
          自动发现 {autoCount} 页 · 人工补选 {manualCount} 页 · 图源待处理 {pendingCount} 页
        </span>
        <span className="flex items-center gap-1">
          {ready && <Check size={14} />}
          {controller.selectionSaving
            ? '正在保存页面选择…'
            : controller.saveStatus === '已保存'
              ? '完整处理单元及时保存'
              : `汇报要求${controller.saveStatus}`}
        </span>
      </footer>
      {controller.pendingSelection && (
        <ProjectDialog title="取消图源页处理" busy={controller.selectionSaving} onClose={controller.discardSelection}>
          <p className="text-sm leading-relaxed">
            此页已产生 {controller.pendingSelection.impact.figureIds.length} 个 Figure、
            {controller.pendingSelection.impact.sourceIds.length} 处图源及{' '}
            {controller.pendingSelection.impact.evidenceIds.length}{' '}
            条证据引用。取消将移除该页图源，重新整理受影响关联；原文和已有稿件保留。
          </p>
          <div className="mt-4 max-h-52 overflow-y-auto rounded border border-line bg-panel p-3 text-xs leading-relaxed">
            <p className="font-medium">受影响的图与证据</p>
            {paper.figures
              .filter((figure) => controller.pendingSelection?.impact.figureIds.includes(figure.id))
              .map((figure) => (
                <p key={figure.id} className="mt-2">
                  {figure.label || '未标号 Figure'} · {figure.caption || figure.description || '该页图源'}
                </p>
              ))}
            {paper.evidences
              .filter((evidence) => controller.pendingSelection?.impact.evidenceIds.includes(evidence.id))
              .map((evidence) => (
                <p key={evidence.id} className="mt-2 text-muted">
                  {evidence.summary}
                </p>
              ))}
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <Button disabled={controller.selectionSaving} onClick={controller.discardSelection}>
              保留选择
            </Button>
            <Button primary disabled={controller.selectionSaving} onClick={controller.confirmSelection}>
              {controller.selectionSaving ? '正在保存…' : '确认取消图源处理'}
            </Button>
          </div>
        </ProjectDialog>
      )}
    </div>
  );
}
