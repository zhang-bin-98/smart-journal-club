import { FigureInspector } from './FigureInspector';
import { FigureDialogs } from './FigureDialogs';

import { ArrowLeft, Check, Settings, Sparkles } from 'lucide-react';
import { recognizeReviewFigure } from '../../app/composition';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { Brand, Button, IconButton, inputClass, errorMessage } from '../controls';
import { WorkspaceDivider } from './PagePreview';
import { FigureCard } from './FigureCard';
import { FigureDestinationInput } from './FigureDestination';

import { useFigureReview } from './useFigureReview';
export function FigureReviewPage({
  id,
  settings,
  onSettings,
  onLeave,
  onStep,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  onSettings: () => void;
  onLeave: () => void;
  onStep: (step: 'paper-analysis' | 'slides' | 'outline-speech') => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const controller = useFigureReview({ id, settings, registerLeaveGuard });
  if (!controller.ready)
    return (
      <main className="p-6">
        <Button onClick={onLeave}>返回项目列表</Button>
        <p role={controller.error ? 'alert' : 'status'}>{controller.error || '正在打开图源核对…'}</p>
        {controller.error && <Button onClick={() => void controller.act(controller.session.load)}>重试读取</Button>}
      </main>
    );
  const {
    session,
    state,
    resources,
    regionId,
    panelId,
    draft,
    setDraft,
    mode,
    setMode,
    label,
    setLabel,
    title,
    setTitle,
    association,
    filter,
    setFilter,
    directory,
    setDirectory,
    viewed,
    setViewed,
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    zoom,
    setZoom,
    ai,
    setAi,
    recognizing,
    setRecognizing,
    showCandidate,
    setShowCandidate,
    error,
    setError,
    failed,
    act,
    commit,
    cancel,
    select,
    jump,
    paper,
    project,
    current,
    confirmed,
    manual,
    concerns,
    figures,
    candidatePaper,
    busy,
    saveTitle,
    startTitle,
  } = controller;
  return (
    <div className="flex h-dvh min-w-[1100px] flex-col overflow-hidden bg-canvas text-sm text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton label="返回项目列表" onClick={onLeave}>
            <ArrowLeft size={16} />
          </IconButton>
          <Brand />
          <span className="max-w-96 truncate" title={project.name}>
            {project.name}
          </span>
          <span className="text-xs text-muted">{busy ? '正在保存…' : state.dirty ? '未保存输入' : '已保存'}</span>
        </div>
        <div className="flex gap-2">
          <IconButton label="模型配置" onClick={onSettings}>
            <Settings size={16} />
          </IconButton>
          <Button
            primary
            disabled={busy || state.dirty}
            onClick={() => void commit({ kind: 'confirm', at: Date.now() })}
          >
            <Check size={16} />
            {confirmed ? '切分已确认' : '确认切分'}
          </Button>
        </div>
      </header>
      <nav
        aria-label="项目步骤"
        className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-white px-5 text-xs"
      >
        <button onClick={() => onStep('paper-analysis')}>1 论文分析</button>
        <span className="font-semibold text-accent">2 图源核对</span>
        <button disabled={!project.currentDeckId} onClick={() => onStep('outline-speech')}>
          3 大纲与演讲稿
        </button>
        <button disabled={!project.currentDeckId} onClick={() => onStep('slides')}>
          4 幻灯片
        </button>
        <span className="ml-auto text-muted">
          {confirmed ? '当前切分版本已保存；讲稿生成功能将在后续阶段接入' : '修改边框、标签或归属后需重新确认'}
        </span>
      </nav>
      {(error || state.error) && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700"
        >
          <span>{error || state.error}</span>
          {failed && (
            <Button disabled={busy} onClick={controller.retry}>
              重试保存
            </Button>
          )}
          {state.dirty && (
            <Button disabled={busy} onClick={cancel}>
              取消未保存修改
            </Button>
          )}
        </div>
      )}
      <main className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col bg-white" style={{ width: leftWidth }}>
          <div className="space-y-2 border-b border-line p-3">
            <select
              aria-label="图源目录"
              className={inputClass}
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            >
              <option value="figures">按图浏览</option>
              <option value="findings">按发现</option>
              <option value="pages">原文页面</option>
            </select>
            <select
              aria-label="筛选图源"
              className={inputClass}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">全部图源</option>
              <option value="issues">有切分疑点</option>
              <option value="manual">人工调整</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {directory === 'figures' &&
              paper.documents.map((doc) => (
                <section key={doc.id} className="mb-5">
                  <h2 className="mb-2 break-words text-xs font-medium">
                    {doc.role === 'primary' ? '主论文' : '补充材料'} · {doc.fileName}
                  </h2>
                  {figures.map((figure) =>
                    figure.regions
                      .filter(
                        (region) =>
                          paper.sources.find((source) => source.id === region.sourceId)?.documentId === doc.id,
                      )
                      .map((region) => (
                        <div
                          key={region.id}
                          className={`mb-2 rounded border p-2 ${regionId === region.id ? 'border-accent bg-accent/5' : 'border-line'}`}
                        >
                          <button className="w-full text-left text-xs font-medium" onClick={() => jump(region.id)}>
                            {figure.label || '未标号 Figure'}{' '}
                            <span className="font-normal text-muted">
                              · {manual(figure.id) ? '已修改' : viewed.has(region.id) ? '已查看' : '未查看'}
                            </span>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {region.panels.map((item) => (
                              <button
                                key={item.id}
                                className={`rounded border px-2 py-1 text-xs ${item.id === panelId ? 'border-accent' : 'border-line'}`}
                                onClick={() => jump(region.id, item.id)}
                              >
                                {item.label || '?'}
                              </button>
                            ))}
                          </div>
                          {!!concerns(figure.id).length && (
                            <p className="mt-2 text-[11px] text-amber-700">
                              {concerns(figure.id).length} 项切分或关联疑点
                            </p>
                          )}
                        </div>
                      )),
                  )}
                </section>
              ))}
            {directory === 'findings' &&
              paper.claims.map((claim) => {
                const sourceIds = paper.evidences
                  .filter((item) => claim.evidenceIds.includes(item.id))
                  .flatMap((item) => item.sourceIds);
                const regions = paper.figures.flatMap((figure) =>
                  figure.regions.filter(
                    (region) =>
                      sourceIds.includes(region.sourceId) ||
                      region.panels.some((panel) => sourceIds.includes(panel.sourceId)),
                  ),
                );
                return (
                  <div key={claim.id} className="mb-3 border-b border-line pb-3 text-xs leading-relaxed">
                    <p>{claim.text}</p>
                    {regions.map((region) => (
                      <Button key={region.id} onClick={() => jump(region.id)}>
                        查看关联图
                      </Button>
                    ))}
                    {!regions.length && <p className="text-muted">暂无明确图源关联</p>}
                  </div>
                );
              })}
            {directory === 'findings' &&
              paper.evidences
                .filter((evidence) => !evidence.sourceIds.length)
                .map((evidence) => (
                  <p key={evidence.id} className="mb-3 rounded border border-amber-200 p-3 text-xs leading-relaxed">
                    {evidence.summary}
                    <span className="mt-1 block text-amber-700">图源关联已移除，原事实保留</span>
                  </p>
                ))}
            {directory === 'pages' &&
              paper.pages.map((page) => (
                <Button
                  key={`${page.documentId}:${page.pageNumber}`}
                  className="mb-2 w-full"
                  disabled={state.dirty || !!title}
                  onClick={() => {
                    startTitle();
                    setTitle({ value: '', documentId: page.documentId, pageNumber: page.pageNumber });
                  }}
                >
                  {paper.documents.find((doc) => doc.id === page.documentId)?.role === 'primary'
                    ? '主论文'
                    : '补充材料'}{' '}
                  第 {page.pageNumber} 页 · 查看/补整图
                </Button>
              ))}
            {!figures.length && <Button onClick={() => setFilter('all')}>显示全部</Button>}
          </div>
        </aside>
        <WorkspaceDivider label="调整图源目录宽度" width={leftWidth} min={190} max={320} onChange={setLeftWidth} />
        <section className="flex min-w-[320px] flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white p-3">
            {(['select', 'panel', 'region'] as const).map((value) => (
              <Button
                key={value}
                disabled={busy || state.dirty || !!title || association !== undefined || !current}
                primary={mode === value}
                onClick={() => {
                  setMode(value);
                  setDraft(undefined);
                }}
              >
                {value === 'select' ? '选取' : value === 'panel' ? '＋ 添加 Panel' : '整图边界'}
              </Button>
            ))}
            <Button disabled={busy || state.dirty || !!title || association !== undefined} onClick={() => startTitle()}>
              ＋ 添加 Figure
            </Button>
            <Button disabled={!state.canUndo || busy || state.dirty} onClick={() => void act(session.undo)}>
              撤销
            </Button>
            <Button disabled={!state.canRedo || busy || state.dirty} onClick={() => void act(session.redo)}>
              重做
            </Button>
            <select
              aria-label="图源缩放"
              className={inputClass.replace('w-full', 'w-24')}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              <option value={1}>适配</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
            <details className="relative">
              <summary className="cursor-pointer rounded border border-line px-3 py-2 text-xs">更多</summary>
              <div className="absolute right-0 top-full z-20 w-52 space-y-2 rounded border border-line bg-white p-3 shadow">
                <Button
                  disabled={!current || state.dirty || busy || recognizing || !settings.apiKey}
                  onClick={() => {
                    if (!current) return;
                    setRecognizing(true);
                    void act(() =>
                      session.recognize((data, signal) =>
                        recognizeReviewFigure({ data, figureId: current.figure.id, resources, settings, signal }),
                      ),
                    ).finally(() => setRecognizing(false));
                  }}
                >
                  重新识别当前图
                </Button>
                <Button
                  disabled={!current || busy || state.dirty}
                  onClick={() => {
                    if (current) {
                      try {
                        session.baseline(current.figure.id);
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    }
                  }}
                >
                  恢复自动结果
                </Button>
              </div>
            </details>
          </div>
          {recognizing && (
            <div role="status" className="flex shrink-0 items-center justify-between bg-panel px-4 py-2 text-xs">
              <span>正在局部高清识别，原人工结果保留</span>
              <Button onClick={session.cancelRecognition}>取消识别</Button>
            </div>
          )}
          {state.candidate && (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 p-3 text-xs">
              <p>{state.candidate.label} · 仅替换当前 Figure 的切分；未应用候选仅本次会话保留</p>
              <div className="mt-2 flex gap-2">
                <Button onClick={() => setShowCandidate(!showCandidate)}>
                  {showCandidate ? '隐藏自动候选框' : '叠加自动候选框'}
                </Button>
                <Button primary onClick={() => void act(session.applyCandidate)}>
                  应用候选
                </Button>
                <Button onClick={session.discardCandidate}>放弃候选</Button>
              </div>
            </div>
          )}
          {mode === 'panel' && draft && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-white p-3">
              <input
                id="new-panel-label"
                aria-label="新 Panel 标签"
                className={`${inputClass} max-w-40`}
                placeholder="标签可留空"
                value={label ?? ''}
                onChange={(event) => {
                  session.register('box');
                  setLabel(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter')
                    void commit({
                      kind: 'add-panel',
                      regionId: draft.regionId,
                      bbox: draft.bbox,
                      label,
                      id: crypto.randomUUID(),
                    }).then((saved) => {
                      if (saved) setMode('select');
                    });
                  if (event.key === 'Escape') cancel();
                }}
              />
              <Button
                disabled={busy}
                onClick={() =>
                  void commit({
                    kind: 'add-panel',
                    regionId: draft.regionId,
                    bbox: draft.bbox,
                    label,
                    id: crypto.randomUUID(),
                  }).then((saved) => {
                    if (saved) setMode('select');
                  })
                }
              >
                保存 Panel
              </Button>
              <Button disabled={busy} onClick={cancel}>
                取消
              </Button>
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto p-4"
            onScroll={(event) => {
              if (state.dirty || title || draft || busy) return;
              const top = event.currentTarget.getBoundingClientRect().top + 70;
              const card = [...event.currentTarget.querySelectorAll<HTMLElement>('article[data-region]')].find(
                (node) => node.getBoundingClientRect().bottom > top,
              );
              const next = card?.dataset.region;
              if (next && next !== regionId) select(next);
            }}
          >
            {!figures.length && (
              <p className="p-5 text-muted">没有符合条件的图。原页仍可从“原文页面”查看，也可添加漏掉的 Figure。</p>
            )}
            {figures.flatMap((figure) =>
              figure.regions.map((region) => (
                <FigureCard
                  key={region.id}
                  paper={paper}
                  figure={figure}
                  regionId={region.id}
                  resources={resources}
                  selectedRegion={regionId}
                  selectedPanel={panelId}
                  mode={mode}
                  zoom={zoom}
                  draft={draft}
                  candidate={candidatePaper}
                  disabled={busy || !!title || association !== undefined || (label !== undefined && mode !== 'panel')}
                  onSelect={select}
                  onVisible={() => {
                    if (!state.dirty && !draft) {
                      setViewed((old) => (old.has(region.id) ? old : new Set([...old, region.id])));
                    }
                  }}
                  onStart={() => session.register('box')}
                  onDraft={(bbox) =>
                    setDraft({ regionId: region.id, panelId: mode === 'select' ? panelId : undefined, bbox })
                  }
                  onCommit={(bbox) => {
                    if (mode === 'panel')
                      requestAnimationFrame(() =>
                        document.getElementById('new-panel-label')?.focus({ preventScroll: true }),
                      );
                    if (mode !== 'panel')
                      void commit({
                        kind: 'box',
                        regionId: region.id,
                        panelId: mode === 'select' ? panelId : undefined,
                        bbox,
                      });
                  }}
                  onCancel={cancel}
                  onTitle={() => startTitle(region.id)}
                  titleEditor={
                    title?.regionId === region.id ? (
                      <div
                        className="min-w-0 flex-1"
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === 'Enter') void saveTitle();
                          if (event.key === 'Escape') cancel();
                        }}
                      >
                        <FigureDestinationInput
                          paper={paper}
                          value={title.value}
                          selectedId={title.selectedId}
                          onChange={(value, selectedId) => {
                            session.register('title');
                            setTitle({ ...title, value, selectedId });
                          }}
                        />
                        <div className="mt-2 flex gap-2">
                          <Button disabled={busy} onClick={() => void saveTitle()}>
                            保存图块
                          </Button>
                          <Button disabled={busy} onClick={cancel}>
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : undefined
                  }
                  onDelete={() => {
                    if (panelId && mode === 'select' && !state.dirty)
                      void commit({ kind: 'delete-panel', regionId: region.id, panelId });
                  }}
                />
              )),
            )}
          </div>
        </section>
        <WorkspaceDivider
          label="调整图源预览栏宽度"
          width={rightWidth}
          min={280}
          max={500}
          reverse
          onChange={setRightWidth}
        />
        <FigureInspector controller={controller} settings={settings} />
      </main>
      <footer className="flex shrink-0 items-center justify-between border-t border-line bg-white px-5 py-2 text-xs text-muted">
        <span>
          {paper.figures.length} 个 Figure · 已浏览 {viewed.size} 个图块 ·{' '}
          {confirmed ? '当前切分已确认' : '等待整体确认'}
        </span>
        <Button onClick={() => setAi(!ai)}>
          <Sparkles size={14} />
          {ai ? '收起 AI' : '展开 AI 只读问答'}
        </Button>
      </footer>
      <FigureDialogs controller={controller} settings={settings} />{' '}
    </div>
  );
}
