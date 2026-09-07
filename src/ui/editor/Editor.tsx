import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Crop,
  Download,
  FileText,
  List,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  Quote,
  RefreshCw,
  Redo2,
  Settings,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { DeckSession } from '../../modules/deck/DeckSession';
import type { Deck, Element, LayoutId } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import { Brand, Button, errorMessage, IconButton } from '../controls';
import { SlidePreview, type Editing, type FigureImage } from './SlidePreview';
import { computeLayout } from '../../modules/deck/layout/computeLayout';
import { AiPanel } from './AiPanel';
import { setDirty, type RegisterLeaveGuard } from '../../app/activity';
import { useEditorController } from './useEditorController';
import { DEFAULT_SETTINGS } from '../../shared/llm/model';
import { useAssistantController } from './useAssistantController';
import { AiCommandBar } from './AiCommandBar';
import { Inspector, type InspectorTab } from './Inspector';
import { SectionNavigator } from './SectionNavigator';
import type {
  CheckLocation,
  PresentationCheck,
  PresentationExportOptions,
} from '../../app/presentation/checkPresentation';

export type EditorFocusTarget = CheckLocation & { requestId: number };
export function Editor({
  session,
  paper,
  image,
  name,
  initialSlideId,
  onLeave,
  onExport,
  onSelection,
  onSource,
  onSettings,
  notice,
  aiSettings,
  aiPaper,
  aiProjectId,
  aiPreferences,
  aiPersistRevision,
  readOnly = false,
  resourceAvailable = true,
  registerLeaveGuard,
  onRegenerate,
  onReanalyze,
  onRestore,
  taskStatus,
  onCancelTask,
  externalError,
  onCheck,
  focusTarget,
}: {
  session: DeckSession;
  paper: Paper;
  image: FigureImage;
  name: string;
  initialSlideId?: string;
  onLeave?: () => void;
  onExport: (deck: Deck, options?: PresentationExportOptions) => Promise<void>;
  onCheck?: (deck: Deck) => PresentationCheck;
  focusTarget?: EditorFocusTarget;
  onSelection?: (id?: string) => Promise<void>;
  onSettings?: () => void;
  aiSettings?: import('../../shared/llm/model').ModelSettings;
  aiPaper?: Paper;
  aiProjectId?: string;
  aiPreferences?: import('../../modules/project/project.schema').Project['preferences'];
  aiPersistRevision?: import('../../modules/assistant/revision/applyRevision').PersistAssistantRevision;
  notice?: string;
  readOnly?: boolean;
  resourceAvailable?: boolean;
  registerLeaveGuard?: RegisterLeaveGuard;
  onRegenerate?: () => void;
  onReanalyze?: () => void;
  onRestore?: (deck: Deck) => Promise<void>;
  taskStatus?: string;
  onCancelTask?: () => void;
  externalError?: string;
  onSource?: (
    sourceId: string,
    element: Extract<Element, { type: 'figure' }> | undefined,
    slideId: string,
    crop: boolean,
    apply: (element: Extract<Element, { type: 'figure' }>) => Promise<void>,
    onDraft: () => void,
  ) => void;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('content');
  const [exportConfirmVersion, setExportConfirmVersion] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const controller = useEditorController({
    session,
    paper,
    readOnly,
    resourceAvailable,
    initialSlideId,
    onSelection,
    onSource,
    onExport,
    registerLeaveGuard,
  });
  const {
    deck,
    slide,
    element,
    selectedElement,
    setSelectedElement,
    status,
    setStatus,
    error,
    setError,
    exporting,
    exportPresentation,
    startExport,
    aiBusy,
    manualNotice,
    manualEdit,
    aiBusyChanged,
    registerAiCancel,
    cancelAi,
    dirtyKey,
    draft,
    changed,
    commit,
    saveText,
    flush,
    run,
    select,
    source,
    addSlide,
    move,
    history,
    addElement,
    navigationOpen,
    setNavigationOpen,
  } = controller;
  const assistant = useAssistantController({
    session,
    paper: aiPaper ?? paper,
    settings: aiSettings ?? DEFAULT_SETTINGS,
    projectId: aiProjectId,
    preferences: aiPreferences,
    persistRevision: aiPersistRevision,
    selectedSlideId: slide?.id,
    selectedElementId: selectedElement,
    onChanged: changed,
    beforeSend: flush,
    beforeUndo: flush,
    onBusyChange: aiBusyChanged,
    registerCancel: registerAiCancel,
    disabled: readOnly || !aiSettings,
  });
  const geometry = slide && computeLayout(slide);
  const crowded =
    geometry &&
    (geometry.titleText.overflow ||
      geometry.messageText.overflow ||
      geometry.elements.some((item) => item.text.overflow));
  useEffect(() => {
    setDirty(`${dirtyKey}-panels`, navigationOpen || inspectorOpen || menuOpen);
  }, [dirtyKey, navigationOpen, inspectorOpen, menuOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: requestId 是检查页定位命令的唯一触发标识，controller 函数每次渲染都会重建
  useEffect(() => {
    if (!focusTarget?.slideId) return;
    void run(async () => {
      await select(focusTarget.slideId);
      setSelectedElement(focusTarget.elementId);
      setInspectorTab(focusTarget.inspectorTab);
      setInspectorCollapsed(false);
    });
  }, [focusTarget?.requestId]);
  const check = onCheck?.(deck);
  const issues = check ? [...check.errors, ...check.warnings] : [];
  const figure = element?.type === 'figure' ? paper.figures.find((item) => item.id === element.figureId) : undefined;
  const sourceId =
    element?.type === 'figure'
      ? element.panelId
        ? figure?.panels.find((panel) => panel.id === element.panelId)?.sourceId
        : figure?.sourceId
      : undefined;
  const editing: Editing | undefined = readOnly
    ? undefined
    : {
        onDraft: (value) => {
          if (value.value !== value.original) manualEdit();
          setDirty(dirtyKey, value.composing || value.value !== value.original);
          draft.current = value;
          setStatus(value.value === value.original ? '已保存' : '未保存');
        },
        onBlur: () => {
          void flush().catch((cause) => setError(errorMessage(cause)));
        },
        onSave: saveText,
        hasDraft: (key) => draft.current?.key === key,
      };
  const deleteElement = async () => {
    if (!slide || !element) return;
    await commit(
      { type: 'slides', slideIds: [slide.id] },
      [{ type: 'delete-element', slideId: slide.id, elementId: element.id }],
      '删除元素',
    );
    setSelectedElement(undefined);
  };
  const changeLayout = (layoutId: LayoutId) => {
    if (!slide) return;
    void run(() =>
      commit(
        { type: 'slides', slideIds: [slide.id] },
        [{ type: 'update-slide', slideId: slide.id, changes: { layoutId } }],
        '切换布局',
      ),
    );
  };
  const requestExport = () =>
    run(async () => {
      const currentCheck = onCheck?.(session.current);
      if (currentCheck?.errors.length) {
        setError(`检查发现 ${currentCheck.errors.length} 个错误，请先修复后导出。`);
        return;
      }
      if (currentCheck?.warnings.length) {
        setExportConfirmVersion(currentCheck.version);
        return;
      }
      await startExport();
    });
  return (
    <main className="mx-auto min-h-screen max-w-[1600px] p-3 font-sans text-ink sm:p-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        {onLeave && (
          <IconButton label="返回首页" disabled={readOnly} onClick={onLeave}>
            <ArrowLeft size={16} />
          </IconButton>
        )}
        <Brand />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
        <span role="status" className={`text-xs ${status === '未保存' ? 'text-red-700' : 'text-success'}`}>
          {status}
        </span>
        <Button
          primary
          disabled={
            !deck.slides.length ||
            exporting ||
            !!check?.errors.length ||
            (!resourceAvailable &&
              deck.slides.some((item) => item.elements.some((element) => element.type === 'figure')))
          }
          onClick={() => void requestExport()}
        >
          <Download size={15} />
          {exporting ? '正在导出…' : '导出 PPTX'}
        </Button>
        {onSettings && (
          <IconButton label="模型设置" disabled={exporting || aiBusy || readOnly} onClick={() => void run(onSettings)}>
            <Settings size={17} />
          </IconButton>
        )}
        {onRegenerate && (
          <div className="relative">
            <IconButton
              label="更多操作"
              disabled={readOnly || aiBusy || exporting}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal size={17} />
            </IconButton>
            {menuOpen && (
              <div className="absolute top-11 right-0 z-20 grid min-w-48 gap-1 rounded border border-line bg-white p-1 shadow-sm">
                <Button
                  disabled={!resourceAvailable}
                  onClick={() =>
                    void run(() => {
                      setMenuOpen(false);
                      onRegenerate();
                    })
                  }
                >
                  <RefreshCw size={15} />
                  重新生成整套 PPT
                </Button>
                {onRestore && (
                  <Button
                    onClick={() =>
                      void run(async () => {
                        setMenuOpen(false);
                        cancelAi();
                        await onRestore(session.current);
                      })
                    }
                  >
                    <Undo2 size={15} />
                    恢复上一版
                  </Button>
                )}
                {onReanalyze && (
                  <Button
                    disabled={!resourceAvailable || !!taskStatus}
                    onClick={() =>
                      void run(() => {
                        setMenuOpen(false);
                        onReanalyze();
                      })
                    }
                  >
                    <FileText size={15} />
                    在新项目中重新分析同一论文
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </header>
      {taskStatus && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
          <span>{taskStatus}</span>
          {onCancelTask && (
            <Button onClick={onCancelTask}>
              <X size={15} />
              取消重生成
            </Button>
          )}
        </div>
      )}
      {externalError && (
        <p role="alert" className="border-b border-red-200 py-3 text-sm text-red-700">
          {externalError}
        </p>
      )}
      {!resourceAvailable && (
        <p role="alert" className="border-b border-line py-3 text-sm text-red-700">
          原 PDF 缺失，来源查看、裁图及含图文稿导出不可用；已保存的文字仍可编辑。
        </p>
      )}
      {manualNotice && (
        <p role="status" className="border-b border-line py-2 text-xs text-muted">
          {manualNotice}
        </p>
      )}
      {notice && <p className="border-b border-line py-2 text-xs text-muted">{notice}</p>}
      {error && (
        <div role="alert" className="flex items-center gap-3 border-b border-red-200 py-3 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          {draft.current && <Button onClick={() => void run(async () => {})}>重试保存</Button>}
        </div>
      )}
      {exportConfirmVersion && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 py-3 text-sm text-amber-900">
          <span className="min-w-0 flex-1">
            当前已保存版本有 {check?.warnings.length ?? 0} 个警告；确认查看后可继续导出。内容改变后本次确认自动失效。
          </span>
          <Button onClick={() => setExportConfirmVersion(undefined)}>取消</Button>
          <Button
            primary
            disabled={exporting}
            onClick={() => {
              const accepted = exportConfirmVersion;
              setExportConfirmVersion(undefined);
              void exportPresentation({ warningsAcceptedFor: accepted });
            }}
          >
            确认警告并导出
          </Button>
        </div>
      )}
      <div className="mt-3 flex gap-2 xl:hidden">
        <span className="md:hidden">
          <Button onClick={() => setNavigationOpen(true)}>
            <List size={15} />
            章节与页面
          </Button>
        </span>
        <Button
          onClick={() => {
            setInspectorCollapsed(false);
            setInspectorOpen(true);
          }}
        >
          <PanelRightOpen size={15} />
          Inspector{aiBusy ? ' · AI 运行中' : ''}
        </Button>
      </div>
      <div
        className={`mt-4 grid min-h-[680px] grid-cols-1 border border-line bg-white md:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)] ${
          inspectorCollapsed ? 'xl:grid-cols-[190px_minmax(0,1fr)_48px]' : 'xl:grid-cols-[190px_minmax(0,1fr)_320px]'
        }`}
      >
        <ResponsivePanel label="章节与页面" side="left" open={navigationOpen} onClose={() => setNavigationOpen(false)}>
          <SectionNavigator
            deck={deck}
            paper={paper}
            image={image}
            selectedSlideId={slide?.id}
            issues={issues}
            readOnly={readOnly}
            onAdd={() => void run(addSlide)}
            onSelect={(id) => void run(() => select(id))}
            onMove={(id, afterSlideId, targetSectionId) => void run(() => move(id, afterSlideId, targetSectionId))}
          />
        </ResponsivePanel>
        <section className="min-w-0 p-3 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-sm font-semibold">{slide?.title || '还没有幻灯片'}</h2>
            <IconButton
              label="删除本页"
              disabled={!slide || readOnly}
              onClick={() =>
                void run(async () => {
                  if (!slide) return;
                  const index = deck.slides.indexOf(slide);
                  await commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: slide.id }], '删除幻灯片');
                  await select(session.current.slides[Math.min(index, session.current.slides.length - 1)]?.id);
                })
              }
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
          <div className="mt-4 grid min-h-[240px] place-items-center bg-canvas p-2 sm:min-h-[440px] sm:p-4">
            {slide ? (
              <SlidePreview
                key={slide.id}
                slide={slide}
                paper={paper}
                image={image}
                selectedElement={selectedElement}
                onSelect={setSelectedElement}
                onSource={(id) => source(id)}
                editing={editing}
              />
            ) : (
              <Button disabled={readOnly} onClick={() => void run(addSlide)}>
                <Plus size={16} />
                新增页
              </Button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            {crowded && (
              <p role="status" className="w-full text-xs text-red-700">
                本页文字可能溢出，请精简文字或拆页后核对导出。
              </p>
            )}
            <IconButton
              label="新增文字"
              disabled={!slide || readOnly}
              onClick={() => void run(() => addElement('text'))}
            >
              <FileText size={15} />
            </IconButton>
            <IconButton
              label="新增列表"
              disabled={!slide || readOnly}
              onClick={() => void run(() => addElement('bullet-list'))}
            >
              <List size={15} />
            </IconButton>
            <IconButton
              label="新增引用"
              disabled={!slide?.sourceIds.length || readOnly}
              onClick={() => void run(() => addElement('citation'))}
            >
              <Quote size={15} />
            </IconButton>
            {element && (
              <IconButton label="删除选中元素" disabled={readOnly} onClick={() => void run(deleteElement)}>
                <Trash2 size={15} />
              </IconButton>
            )}
            {sourceId && onSource && (
              <>
                <Button disabled={!resourceAvailable} onClick={() => source(sourceId)}>
                  <FileText size={15} />
                  查看来源
                </Button>
                <IconButton
                  label="裁图"
                  disabled={readOnly || !resourceAvailable}
                  onClick={() => source(sourceId, true)}
                >
                  <Crop size={15} />
                </IconButton>
              </>
            )}
            <div className="ml-auto flex gap-2">
              <IconButton
                label="撤销"
                disabled={!session.canUndo || readOnly}
                onClick={() => void run(() => history('undo'))}
              >
                <Undo2 size={16} />
              </IconButton>
              <IconButton
                label="重做"
                disabled={!session.canRedo || readOnly}
                onClick={() => void run(() => history('redo'))}
              >
                <Redo2 size={16} />
              </IconButton>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>
              第 {slide ? deck.slides.indexOf(slide) + 1 : 0} / {deck.slides.length} 页
            </span>
            <div className="flex gap-2">
              <IconButton
                label="上移本页"
                disabled={!slide || deck.slides.indexOf(slide) === 0 || readOnly}
                onClick={() =>
                  void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) - 2]?.id ?? null))
                }
              >
                <ArrowUp size={15} />
              </IconButton>
              <IconButton
                label="下移本页"
                disabled={!slide || deck.slides.indexOf(slide) === deck.slides.length - 1 || readOnly}
                onClick={() => void run(() => move(slide!.id, deck.slides[deck.slides.indexOf(slide!) + 1].id))}
              >
                <ArrowDown size={15} />
              </IconButton>
            </div>
          </div>
        </section>
        <ResponsivePanel label="Inspector" side="right" open={inspectorOpen} onClose={() => setInspectorOpen(false)}>
          {inspectorCollapsed ? (
            <div className="hidden h-full flex-col items-center bg-panel py-2 xl:flex">
              <IconButton label="展开 Inspector" onClick={() => setInspectorCollapsed(false)}>
                <PanelRightOpen size={16} />
              </IconButton>
              <span className="mt-2 [writing-mode:vertical-rl] text-[11px] tracking-wider text-muted">Inspector</span>
            </div>
          ) : (
            <Inspector
              slide={slide}
              element={element}
              paper={paper}
              tab={inspectorTab}
              onTab={setInspectorTab}
              onCollapse={() => {
                setInspectorCollapsed(true);
                setInspectorOpen(false);
              }}
              onSource={(id) => source(id)}
              onCrop={(id) => source(id, true)}
              onDeleteElement={() => void run(deleteElement)}
              onLayout={changeLayout}
              editing={editing}
              resourceAvailable={resourceAvailable}
              readOnly={readOnly}
              ai={
                aiSettings ? (
                  <AiPanel controller={assistant} session={session} paper={aiPaper ?? paper} disabled={readOnly} />
                ) : undefined
              }
            />
          )}
        </ResponsivePanel>
      </div>
      {aiSettings && (
        <AiCommandBar
          controller={assistant}
          session={session}
          settings={aiSettings}
          selectedElementId={selectedElement}
          disabled={readOnly}
        />
      )}
    </main>
  );
}
function ResponsivePanel({
  label,
  side,
  open,
  onClose,
  children,
}: {
  label: string;
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia(side === 'left' ? '(min-width: 768px)' : '(min-width: 1280px)');
    if (desktop.matches) {
      close.current();
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const checkWidth = () => {
      if (desktop.matches) close.current();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    desktop.addEventListener('change', checkWidth);
    return () => {
      desktop.removeEventListener('change', checkWidth);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open, side]);
  const desktopClass =
    side === 'left'
      ? 'md:static md:z-auto md:flex md:h-auto md:w-auto md:border-r md:shadow-none'
      : 'xl:static xl:z-auto xl:flex xl:h-[max(680px,calc(100dvh-200px))] xl:max-h-[900px] xl:w-auto xl:border-l xl:shadow-none';
  const mobileClass = side === 'left' ? 'left-0 w-[min(300px,90vw)]' : 'right-0 w-[min(380px,94vw)]';
  return (
    <>
      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="关闭侧栏遮罩"
          onClick={onClose}
          className={`fixed inset-0 z-40 bg-black/35 ${side === 'left' ? 'md:hidden' : 'xl:hidden'}`}
        />
      )}
      <aside
        ref={panel}
        aria-label={label}
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        tabIndex={-1}
        className={`${open ? 'fixed inset-y-0 z-50 flex h-dvh shadow-xl' : 'hidden'} ${mobileClass} min-h-0 min-w-0 flex-col border-line bg-panel outline-none ${desktopClass}`}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = Array.from(
              panel.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
              ) ?? [],
            ).filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
            const first = controls[0],
              last = controls.at(-1);
            if (!first) {
              event.preventDefault();
              return;
            }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || document.activeElement === panel.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {open && (
          <div
            className={`flex shrink-0 items-center justify-between border-b border-line px-3 py-2 ${side === 'left' ? 'md:hidden' : 'xl:hidden'}`}
          >
            <span className="text-sm font-semibold">{label}</span>
            <IconButton label={`关闭${label}`} onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {children}
      </aside>
    </>
  );
}
