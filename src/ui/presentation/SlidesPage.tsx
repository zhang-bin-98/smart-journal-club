import { useEffect, useMemo, useRef, useState } from 'react';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { WorkspaceStep } from '../../modules/project/model';
import type { Element, DeckMutation } from '../../modules/presentation/editing/schema';
import { slidesService } from '../../app/composition';
import { createSlide } from '../../modules/presentation/editing/mutations';
import { splitSlide, mergeSlides, moveSlideBy } from '../../modules/presentation/editing';
import { checkPresentation } from '../../app/presentation/checkPresentation';
import { figureSource } from '../../modules/paper/sources';
import { Button, Brand, inputClass } from '../controls';
import { WorkspaceDivider } from '../paper/PagePreview';
import { AppHeaderActions } from '../PwaNotice';
import type { Editing } from './SlidePreview';
import { SlideCanvas, VisibleSlide, slideTextMutation } from './SlideCanvas';
import { SlidesInspector } from './SlidesInspector';
import { SlidesSource } from './SlidesSource';
import { useSlidesController } from './useSlidesController';
import { FigureGroupSchema } from '../../modules/presentation/layout';
import { notesText } from '../../modules/presentation/content';
import { SavedVersion } from './SavedVersion';
export function SlidesPage({
  id,
  settings,
  onSettings,
  onLeave,
  onStep,
  onRegenerate,
  onOpenPlan,
  autoStart,
  onStarted,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  onSettings: () => void;
  onLeave: () => void;
  onStep: (step: WorkspaceStep) => void;
  onRegenerate: () => void;
  onOpenPlan: () => void;
  autoStart?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const c = useSlidesController({ id, settings, autoStart, onStarted, registerLeaveGuard });
  const [selected, setSelected] = useState<string>();
  const [multi, setMulti] = useState<string[]>([]);
  const [elementId, setElementId] = useState<string>();
  const [tab, setTab] = useState('content');
  const [left, setLeft] = useState(200);
  const [right, setRight] = useState(320);
  const [speechHeight, setSpeechHeight] = useState(210);
  const [collapsed, setCollapsed] = useState(false);
  const [speechOpen, setSpeechOpen] = useState(true);
  const [focus, setFocus] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [fitWidth, setFitWidth] = useState(800);
  const [aiOpen, setAiOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const [scope, setScope] = useState('current');
  const [filter, setFilter] = useState('all');
  const [candidate, setCandidate] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [source, setSource] = useState<{
    id: string;
    slideId: string;
    element?: Extract<Element, { type: 'figure' }>;
    crop?: boolean;
  }>();
  const [closedSections, setClosedSections] = useState<string[]>([]);
  const [drag, setDrag] = useState<string>();
  const cropEdit = useRef<number | undefined>(undefined);
  const caret = useRef<{ id: string; offset: number } | undefined>(undefined);
  const nav = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const deck = c.deck;
  useEffect(() => {
    if (!canvas.current || !deck?.id) return;
    const target = canvas.current;
    const update = () =>
      setFitWidth(Math.max(240, Math.min(target.clientWidth - 32, ((target.clientHeight - 58) * 16) / 9)));
    const observer = new ResizeObserver(update);
    observer.observe(target);
    update();
    return () => observer.disconnect();
  }, [deck?.id]);
  const data = c.data;
  const selectedSlide =
    deck?.slides.find((s) => s.id === (selected ?? data?.project.lastOpenedSlideId)) ?? deck?.slides[0];
  const selectedId = selectedSlide?.id;
  const groupDraft = selectedId ? c.drafts[`group:${selectedId}`] : undefined;
  const slide = useMemo(() => {
    const group = groupDraft && FigureGroupSchema.safeParse(JSON.parse(groupDraft.value));
    return selectedSlide && group?.success ? { ...selectedSlide, figureGroup: group.data } : selectedSlide;
  }, [selectedSlide, groupDraft]);
  const check = useMemo(() => (deck && data ? checkPresentation(deck, data.paper, true) : undefined), [deck, data]);
  useEffect(() => {
    if (deck) setMulti((ids) => ids.filter((id) => deck.slides.some((s) => s.id === id)));
  }, [deck]);
  function select(value: string) {
    setSelected(value);
    setElementId(undefined);
    if (deck && value !== selectedId) void slidesService.rememberSlide(id, deck.id, value).catch(() => {});
  }
  function jump(value: string) {
    select(value);
    document.getElementById(`slide-${value}`)?.scrollIntoView({ block: 'center' });
  }
  const act = (work: () => Promise<unknown>) => void c.act(work);
  const commit = (mutations: DeckMutation[], summary: string) => act(() => c.commit(mutations, summary));
  function openSource(sourceId: string, element?: Extract<Element, { type: 'figure' }>, crop = false) {
    if (selectedId) setSource({ id: sourceId, element, crop, slideId: selectedId });
  }
  function closeSource() {
    if (cropEdit.current !== undefined) c.session?.releaseDraft(cropEdit.current);
    cropEdit.current = undefined;
    setSource(undefined);
  }
  if (!data)
    return (
      <main className="p-6">
        <Button onClick={onLeave}>返回项目列表</Button>
        <p role={c.error ? 'alert' : 'status'}>{c.error || '正在打开幻灯片…'}</p>
      </main>
    );
  const issues = check
    ? [...check.errors, ...check.warnings].filter(
        (issue) =>
          filter === 'all' || (filter === 'errors' ? issue.severity === 'error' : issue.severity === 'warning'),
      )
    : [];
  const next = deck && slide ? deck.slides[deck.slides.indexOf(selectedSlide!) + 1] : undefined;
  const sourceElement = slide?.elements.find((e) => e.id === elementId);
  const currentSpeech = (slide?.speechIds ?? []).flatMap((id) => deck?.speech?.find((s) => s.id === id) ?? []);
  const editing = (pageId: string): Editing => ({
    hasDraft: (key) => !!c.drafts[`${pageId}:${key}`],
    onDraft: (draft) => {
      if (deck && !draft.composing && draft.value === draft.original) return;
      c.changedDraft(`${pageId}:${draft.key}`, draft.value, slideTextMutation(deck!, pageId, draft.key, draft.value));
    },
    onBlur: () => act(c.flush),
    onSave: async (key, value) => {
      c.changedDraft(`${pageId}:${key}`, value, slideTextMutation(deck!, pageId, key, value));
      await c.flush();
    },
  });
  return (
    <div className="flex h-dvh min-w-[1100px] flex-col overflow-hidden bg-canvas text-sm text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button onClick={onLeave}>返回项目列表</Button>
          <Brand />
          <span className="max-w-64 truncate">{data.project.name}</span>
          <span role="status" className="text-xs text-muted">
            {c.status}
          </span>
        </div>
        <div className="flex gap-2">
          <AppHeaderActions />
          <Button onClick={onSettings}>模型配置</Button>
          <Button
            disabled={c.running}
            onClick={() =>
              act(async () => {
                await c.flush();
                onRegenerate();
              })
            }
          >
            准备完整新稿
          </Button>
          {data.previous && <Button onClick={() => setPrevious(true)}>上一版</Button>}
          <Button
            primary
            disabled={!deck?.slides.length || c.running}
            onClick={() => {
              setTab('check');
              act(c.exportDeck);
            }}
          >
            导出 PPTX
          </Button>
        </div>
      </header>
      <nav
        aria-label="项目步骤"
        className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-white px-5 text-xs"
      >
        <button onClick={() => onStep('paper-analysis')}>1 论文分析</button>
        <button onClick={() => onStep('figure-review')}>2 图源核对</button>
        <button onClick={() => onStep('outline-speech')}>3 大纲与演讲稿</button>
        <span className="font-semibold text-accent">4 幻灯片</span>
        <span className="ml-auto">{c.running ? '正在处理本步骤' : '编辑后自动保存'}</span>
        {c.running ? (
          <>
            <Button onClick={() => c.stop(true)}>立即暂停</Button>
            <Button onClick={() => c.stop()}>取消任务</Button>
          </>
        ) : (
          (!deck || c.paused || data.record?.mode === 'regeneration') && (
            <Button onClick={() => act(c.generate)}>{c.paused ? '继续制作' : '按已保存讲稿制作'}</Button>
          )
        )}
      </nav>
      {c.error && (
        <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">
          {c.error}
          {Object.keys(c.drafts).length > 0 && <Button onClick={() => act(c.flush)}>重试保存输入</Button>}
        </div>
      )}
      {deck && data.record?.mode === 'regeneration' && !c.running && (
        <div className="shrink-0 border-b border-line bg-white px-5 py-2 text-xs">
          <Button onClick={onOpenPlan}>编辑新稿讲稿</Button>
          <span className="ml-3 text-muted">已有讲稿计划保留；完成后由你进入幻灯片继续制作。</span>
        </div>
      )}
      {data.candidate && (
        <div className="flex shrink-0 items-center justify-between border-b border-accent/20 bg-accent/5 px-5 py-2 text-xs">
          <span>有一份完整新稿待查看 · 已保存，可刷新重开{data.candidateStale ? ' · 仅可查看' : ''}</span>
          <Button onClick={() => setCandidate(true)}>查看完整新稿</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside style={{ width: left }} className="flex shrink-0 flex-col overflow-hidden bg-panel">
          <div className="flex items-center justify-between border-b border-line p-2">
            <span className="text-xs">页面 · {deck?.slides.length ?? 0}</span>
            <Button
              disabled={!deck}
              onClick={() => {
                if (deck) {
                  const added = createSlide(
                    crypto.randomUUID(),
                    deck.slides.length + 1,
                    slide?.sectionId ?? deck.sections[0]?.id,
                  );
                  commit([{ type: 'add-slide', slide: added, afterSlideId: slide?.id ?? null }], '新增页');
                  setSelected(added.id);
                }
              }}
            >
              新增页
            </Button>
          </div>
          <div
            ref={nav}
            className="min-h-0 flex-1 space-y-2 overflow-auto p-2"
            onDragOver={(event) => {
              if (!drag || !nav.current) return;
              const rect = nav.current.getBoundingClientRect();
              if (event.clientY < rect.top + 45) nav.current.scrollTop -= 16;
              if (event.clientY > rect.bottom - 45) nav.current.scrollTop += 16;
            }}
          >
            {deck?.slides.map((page, index) => {
              const section = deck.sections.find((s) => s.id === page.sectionId);
              const closed = closedSections.includes(page.sectionId);
              return (
                <div key={page.id}>
                  {(index === 0 || deck.slides[index - 1].sectionId !== page.sectionId) && (
                    <button
                      className="mb-2 w-full text-left text-xs font-medium"
                      onClick={() =>
                        setClosedSections(
                          closed
                            ? closedSections.filter((id) => id !== page.sectionId)
                            : [...closedSections, page.sectionId],
                        )
                      }
                    >
                      {closed ? '▸' : '▾'} {section?.track === 'supplement' ? '补充 · ' : ''}
                      {section?.title}
                    </button>
                  )}
                  {!closed && (
                    <div
                      draggable
                      onDragStart={() => setDrag(page.id)}
                      onDragEnd={() => setDrag(undefined)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (drag && drag !== page.id) {
                          const moved = deck.slides.find((s) => s.id === drag)!;
                          commit(
                            [
                              {
                                type: 'move-slide',
                                slideId: drag,
                                targetSectionId: deck.schemaVersion === 3 ? moved.sectionId : page.sectionId,
                                afterSlideId: page.id,
                              },
                            ],
                            '重排页面',
                          );
                        }
                        setDrag(undefined);
                      }}
                      className={
                        'rounded border p-1 ' +
                        (page.id === selectedId ? 'border-accent bg-accent/5' : 'border-line bg-white')
                      }
                    >
                      <div className="flex items-center gap-2 px-1 py-1 text-xs">
                        <input
                          aria-label={`选择第 ${index + 1} 页`}
                          type="checkbox"
                          checked={multi.includes(page.id)}
                          onChange={(e) =>
                            setMulti(e.target.checked ? [...multi, page.id] : multi.filter((id) => id !== page.id))
                          }
                        />
                        <button className="min-w-0 flex-1 truncate text-left" onClick={() => jump(page.id)}>
                          {index + 1} · {page.title || '未命名页'}
                        </button>
                      </div>
                      <div className="relative w-full">
                        <VisibleSlide slide={page} paper={data.paper} resources={c.resources} />
                        <button
                          className="absolute inset-0"
                          aria-label={`打开第 ${index + 1} 页`}
                          onClick={() => jump(page.id)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-line p-2">
            <Button
              disabled={!multi.length}
              onClick={() =>
                commit(
                  multi.map((slideId) => ({ type: 'delete-slide', slideId })),
                  '删除所选页面',
                )
              }
            >
              删除选中 {multi.length} 页
            </Button>
          </div>
        </aside>
        <WorkspaceDivider label="页面目录宽度" width={left} min={170} max={320} onChange={setLeft} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-white p-2">
            <span className="mr-auto text-xs">
              第 {slide && deck ? deck.slides.indexOf(selectedSlide!) + 1 : 0} / {deck?.slides.length ?? 0} 页
            </span>
            <Button disabled={!c.session?.canUndo} onClick={() => act(() => c.history('undo'))}>
              撤销
            </Button>
            <Button disabled={!c.session?.canRedo} onClick={() => act(() => c.history('redo'))}>
              重做
            </Button>
            <Button onClick={() => setFocus(!focus)}>{focus ? '连续浏览' : '专注当前页'}</Button>
            <Button onClick={() => setZoom(100)}>适配</Button>
            <select
              aria-label="查看缩放"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="rounded border border-control p-1 text-xs"
            >
              <option value={75}>75%</option>
              <option value={100}>100%</option>
              <option value={125}>125%</option>
            </select>
            <Button onClick={() => setSpeechOpen(!speechOpen)}>{speechOpen ? '收起讲稿' : '展开讲稿'}</Button>
          </div>
          <div
            ref={canvas}
            className="min-h-0 flex-1 overflow-auto p-4"
            onScroll={() => {
              if (focus || !canvas.current || Object.keys(c.drafts).length) return;
              const center = canvas.current.getBoundingClientRect().top + canvas.current.clientHeight / 2;
              const items = [...canvas.current.querySelectorAll<HTMLElement>('[data-canvas-page]')];
              const closest = items.sort(
                (a, b) =>
                  Math.abs(a.getBoundingClientRect().top + a.clientHeight / 2 - center) -
                  Math.abs(b.getBoundingClientRect().top + b.clientHeight / 2 - center),
              )[0];
              if (closest?.dataset.canvasPage) setSelected(closest.dataset.canvasPage);
            }}
          >
            {!deck?.slides.length ? (
              <div className="grid h-full place-items-center">
                <p>
                  {deck
                    ? '还没有幻灯片，可新增页或撤销删除。'
                    : c.running
                      ? '正在按完整讲稿规划与制作…'
                      : '完整讲稿已就绪，点击“按已保存讲稿制作”。'}
                </p>
              </div>
            ) : (
              <div className="mx-auto space-y-5" style={{ width: focus ? (fitWidth * zoom) / 100 : `${zoom}%` }}>
                {(focus ? [selectedSlide!] : deck.slides).map((page) => (
                  <section
                    key={page.id}
                    id={`slide-${page.id}`}
                    data-canvas-page={page.id}
                    onClick={() => select(page.id)}
                    onFocus={() => select(page.id)}
                    className="scroll-m-4"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-muted">
                      <span>
                        {deck.slides.indexOf(page) + 1} · {page.title}
                      </span>
                      {page.id === selectedId && <span>当前页</span>}
                    </div>
                    <VisibleSlide slide={page} paper={data.paper} resources={c.resources}>
                      {(visible) =>
                        visible || page.id === selectedId ? (
                          <SlideCanvas
                            slide={page.id === selectedId ? slide! : page}
                            paper={data.paper}
                            resources={c.resources}
                            editing={editing(page.id)}
                            selectedElement={page.id === selectedId ? elementId : undefined}
                            onSelect={(id) => {
                              select(page.id);
                              setElementId(id);
                            }}
                            onSource={(sourceId) => setSource({ id: sourceId, slideId: page.id })}
                          />
                        ) : null
                      }
                    </VisibleSlide>
                  </section>
                ))}
              </div>
            )}
          </div>
          {slide && deck && (
            <div className="flex shrink-0 items-center gap-2 border-y border-line bg-white px-3 py-1">
              <Button
                disabled={deck.slides.indexOf(selectedSlide!) === 0}
                onClick={() => {
                  commit(moveSlideBy(deck, slide.id, -1), '上移页面');
                }}
              >
                上移
              </Button>
              <Button disabled={!next} onClick={() => commit(moveSlideBy(deck, slide.id, 1), '下移页面')}>
                下移
              </Button>
              <Button
                disabled={!next}
                onClick={() => act(() => c.commit(mergeSlides(deck, slide.id, next!.id), '合并页面'))}
              >
                与下一页合页
              </Button>
              <Button onClick={() => commit([{ type: 'delete-slide', slideId: slide.id }], '删除页面')}>
                删除本页
              </Button>
              {sourceElement?.type === 'figure' && (
                <>
                  <Button onClick={() => openSource(figureSource(data.paper, sourceElement).id, sourceElement)}>
                    来源
                  </Button>
                  <Button onClick={() => openSource(figureSource(data.paper, sourceElement).id, sourceElement, true)}>
                    本页裁图
                  </Button>
                </>
              )}
              {sourceElement && (
                <Button
                  onClick={() =>
                    commit([{ type: 'delete-element', slideId: slide.id, elementId: sourceElement.id }], '删除元素')
                  }
                >
                  删除元素
                </Button>
              )}
            </div>
          )}
          {speechOpen && (
            <>
              <div
                role="separator"
                aria-label="讲稿高度"
                aria-orientation="horizontal"
                aria-valuemin={100}
                aria-valuemax={430}
                aria-valuenow={speechHeight}
                tabIndex={0}
                className="h-1.5 shrink-0 cursor-row-resize bg-line hover:bg-accent/40"
                onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={(e) => {
                  if (e.buttons === 1) setSpeechHeight((h) => Math.max(100, Math.min(430, h - e.movementY)));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSpeechHeight((h) => Math.max(100, Math.min(430, h + (e.key === 'ArrowUp' ? 16 : -16))));
                  }
                }}
              />
              <section style={{ height: speechHeight }} className="flex shrink-0 flex-col overflow-hidden bg-white">
                <div className="flex shrink-0 items-center justify-between px-4 py-2">
                  <h2 className="text-xs font-medium">当前页讲稿 · 唯一正文，自动同步备注</h2>
                  <Button
                    onClick={() => {
                      if (currentSpeech[0])
                        sessionStorage.setItem(`smartjc-speech-focus:${id}`, currentSpeech[0].paragraphId);
                      onStep('outline-speech');
                    }}
                  >
                    到大纲编辑
                  </Button>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-3">
                  {!currentSpeech.length && (
                    <p className="text-xs text-muted">
                      本页暂无讲稿。
                      <button className="text-accent" onClick={() => setTab('speech')}>
                        安排讲述
                      </button>
                    </p>
                  )}
                  {currentSpeech.map((segment, index) => (
                    <div key={segment.id}>
                      <textarea
                        aria-label={`本页讲稿 ${index + 1}`}
                        className={`${inputClass} min-h-20 resize-none`}
                        value={c.value(`speech:${segment.id}`, segment.text)}
                        onSelect={(e) => {
                          caret.current = { id: segment.id, offset: e.currentTarget.selectionStart };
                        }}
                        onChange={(e) =>
                          c.changedDraft(`speech:${segment.id}`, e.target.value, {
                            type: 'edit-speech',
                            segmentId: segment.id,
                            text: e.target.value,
                          })
                        }
                        onBlur={() => act(c.flush)}
                      />
                      <div className="mt-1 flex gap-2">
                        <Button
                          onClick={() =>
                            act(() =>
                              c.commit(
                                splitSlide(
                                  c.session!.current,
                                  slide!.id,
                                  segment.id,
                                  caret.current?.id === segment.id && caret.current.offset > 0
                                    ? caret.current.offset
                                    : undefined,
                                ),
                                '按讲述换页',
                              ),
                            )
                          }
                        >
                          从光标 / 本段前换页
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
        <WorkspaceDivider label="幻灯片右栏宽度" width={right} min={280} max={520} reverse onChange={setRight} />
        <aside style={{ width: collapsed ? 44 : right }} className="flex shrink-0 flex-col overflow-hidden bg-panel">
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-line p-2">
            {!collapsed &&
              [
                ['content', '页面'],
                ['source', '图源'],
                ['layout', '图组'],
                ['speech', '讲述分配'],
                ['ai', 'AI'],
                ['check', `检查${check?.errors.length ? ` ${check.errors.length}` : ''}`],
              ].map(([key, name]) => (
                <button
                  key={key}
                  className={`rounded px-2 py-2 text-xs ${key === tab ? 'bg-accent/10 text-accent' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {name}
                </button>
              ))}
            <button
              className="ml-auto p-1 text-xs"
              aria-label={collapsed ? '展开右栏' : '收起右栏'}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '‹' : '›'}
            </button>
          </div>
          {!collapsed && (
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === 'check' ? (
                <div className="space-y-3 p-4">
                  <h3 className="font-medium">检查与导出</h3>
                  <p className="text-xs text-muted">必须修复 {check?.errors.length ?? 0} 项 · 内容建议不阻断导出</p>
                  <select
                    aria-label="检查筛选"
                    className={inputClass}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">全部</option>
                    <option value="errors">阻止导出</option>
                    <option value="warnings">内容建议</option>
                  </select>
                  {issues.map((issue) => (
                    <button
                      key={[issue.code, issue.slideId, issue.elementId, issue.message].join(':')}
                      className={
                        'block w-full rounded border p-3 text-left text-xs ' +
                        (issue.severity === 'error' ? 'border-red-200 bg-red-50' : 'border-line')
                      }
                      onClick={() => {
                        if (issue.slideId) jump(issue.slideId);
                        if (issue.code === 'unassigned-speech') setTab('speech');
                      }}
                    >
                      {issue.message}
                    </button>
                  ))}
                </div>
              ) : tab === 'ai' ? (
                <div className="space-y-4 p-4">
                  <h3 className="font-medium">AI 对话与修改预览</h3>
                  <p className="text-xs text-muted">未应用建议仅本次会话保留。发送后的页面范围固定。</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">
                    {c.answer || '从底部展开输入，提问或请求修改。'}
                  </p>
                  {c.proposal && (
                    <>
                      <p>{c.proposal.args.summary}</p>
                      {c.proposal.preview.slides
                        .filter((s) => c.proposal!.slideIds.includes(s.id))
                        .map((page) => (
                          <div key={page.id} className="space-y-2 border-t border-line pt-3">
                            <p className="text-xs">修改前：{deck?.slides.find((s) => s.id === page.id)?.title}</p>
                            <SlideCanvas slide={page} paper={data.paper} resources={c.resources} thumbnail />
                            <p className="whitespace-pre-wrap text-xs">
                              {notesText(c.proposal!.preview.speech ?? [], page.speechIds ?? [])}
                            </p>
                          </div>
                        ))}
                      <Button primary onClick={() => act(c.applyProposal)}>
                        应用 AI 修改
                      </Button>
                      <Button onClick={() => c.setProposal(undefined)}>放弃建议</Button>
                    </>
                  )}
                </div>
              ) : (
                deck && (
                  <SlidesInspector
                    resources={c.resources}
                    key={selectedId}
                    deck={deck}
                    slide={slide}
                    paper={data.paper}
                    tab={tab}
                    commit={commit}
                    onSource={openSource}
                    changeGroup={(group) => {
                      if (slide)
                        c.changedDraft(`group:${slide.id}`, JSON.stringify(group), {
                          type: 'update-slide',
                          slideId: slide.id,
                          changes: { figureGroup: group },
                        });
                    }}
                    saveGroup={() => act(c.flush)}
                    onSpeech={() => {
                      if (currentSpeech[0])
                        sessionStorage.setItem(`smartjc-speech-focus:${id}`, currentSpeech[0].paragraphId);
                      onStep('outline-speech');
                    }}
                  />
                )
              )}
            </div>
          )}
        </aside>
      </div>
      <footer className="shrink-0 border-t border-line bg-white">
        <div className="flex items-center justify-between px-5 py-2 text-xs">
          <span>
            {c.aiBusy ? 'AI 正在处理' : c.status} · 第 {slide && deck ? deck.slides.indexOf(selectedSlide!) + 1 : 0}/
            {deck?.slides.length ?? 0} 页
          </span>
          <Button
            onClick={() => {
              setAiOpen(!aiOpen);
              setTab('ai');
            }}
          >
            {' '}
            {aiOpen ? '收起 AI 输入' : '展开 AI 输入'}
          </Button>
        </div>
        {aiOpen && (
          <div className="flex items-end gap-2 border-t border-line p-3">
            <select
              aria-label="AI 范围"
              className="rounded border border-control p-2 text-xs"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="current">当前页</option>
              <option value="selected">所选页面</option>
              <option value="all">整稿</option>
            </select>
            <select
              aria-label="AI 模式"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'ask' | 'edit')}
              className="rounded border border-control p-2 text-xs"
            >
              <option value="ask">提问</option>
              <option value="edit">修改</option>
            </select>
            <textarea
              aria-label="幻灯片 AI 输入"
              rows={2}
              className={`${inputClass} max-h-28 flex-1 resize-none`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button
              primary
              disabled={
                c.aiBusy ||
                !question.trim() ||
                !deck ||
                (scope === 'current' && !selectedId) ||
                (scope === 'selected' && !multi.length)
              }
              onClick={() =>
                act(() =>
                  c.send(question, mode, scope === 'all' ? undefined : scope === 'selected' ? multi : [selectedId!]),
                )
              }
            >
              发送
            </Button>
            {c.aiBusy && <Button onClick={c.cancelAi}>取消 AI</Button>}
          </div>
        )}
      </footer>
      {source && (
        <SlidesSource
          key={source.id + String(source.crop)}
          paper={data.paper}
          sourceId={source.id}
          element={source.element}
          crop={source.crop}
          resources={c.resources}
          onClose={closeSource}
          onStart={() => {
            c.cancelAi();
            cropEdit.current = c.session?.registerDraft();
          }}
          onApply={async (bbox) => {
            await c.commit(
              [
                {
                  type: 'replace-element',
                  slideId: source.slideId,
                  element: { ...source.element!, cropOverride: bbox },
                },
              ],
              '保存本页裁图',
            );
            closeSource();
          }}
        />
      )}
      {(candidate || previous) && (
        <SavedVersion
          state={data}
          previous={previous}
          onClose={() => {
            setCandidate(false);
            setPrevious(false);
          }}
          onApply={() =>
            act(async () => {
              const state = previous
                ? await slidesService.restore({
                    projectId: id,
                    currentId: data.current!.id,
                    previousId: data.previous!.id,
                    currentRevision: data.current!.revision,
                    previousRevision: data.previous!.revision,
                    assertActive: () => {
                      if (c.session?.dirty) throw new Error('请先保存输入。');
                    },
                  })
                : await slidesService.candidate({
                    projectId: id,
                    expectedCandidate: data.candidateKey,
                    action: 'apply',
                    assertActive: () => {
                      if (c.session?.dirty) throw new Error('请先保存输入。');
                    },
                  });
              c.accept(state);
              setCandidate(false);
              setPrevious(false);
            })
          }
          onDiscard={() =>
            act(async () => {
              c.accept(
                await slidesService.candidate({
                  projectId: id,
                  expectedCandidate: data.candidateKey,
                  action: 'discard',
                  assertActive: () => {},
                }),
              );
              setCandidate(false);
            })
          }
        />
      )}
    </div>
  );
}
