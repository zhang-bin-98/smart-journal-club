import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Circle, FileText, LoaderCircle, Play, Settings, X } from 'lucide-react';
import { Brand, Button, IconButton, inputClass, useOnline } from '../controls';
import { Editor } from '../editor/Editor';
import { SourceDialog } from '../SourceDialog';
import type { ModelSettings } from '../../shared/llm/model';
import { Checkpoints } from '../../modules/project/project.schema';
import { updateProject } from '../../modules/project/projectRepository';
import { GENERATION_STEPS } from '../../modules/generation/runGeneration';
import type { RegisterLeaveGuard } from '../../app/activity';
import { useProjectWorkspace, type OpenProject } from './useProjectWorkspace';
import { useProjectController } from './useProjectController';
import { OutlineEditor } from '../../modules/outline/ui/OutlineEditor';
import { PaperUnderstanding } from './PaperUnderstanding';
import { FinalOutline } from './FinalOutline';
import { CheckExport } from './CheckExport';

export function ProjectPage({
  id,
  onOpenProject,
  onLeave,
  settings,
  onSettings,
  registerLeaveGuard,
}: {
  id: string;
  onOpenProject: (id: string) => void;
  onLeave: () => void;
  settings: ModelSettings;
  onSettings: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const { opened, error } = useProjectWorkspace(id);
  if (opened)
    return (
      <ProjectContent
        key={id}
        opened={opened}
        onOpenProject={onOpenProject}
        onLeave={onLeave}
        settings={settings}
        onSettings={onSettings}
        registerLeaveGuard={registerLeaveGuard}
      />
    );
  return (
    <main className="mx-auto max-w-[1000px] p-6">
      <Button onClick={onLeave}>
        <ArrowLeft size={16} />
        返回首页
      </Button>
      <p role={error ? 'alert' : 'status'} className="mt-8 text-sm">
        {error || '正在打开项目…'}
      </p>
    </main>
  );
}

function ProjectContent({
  opened,
  onOpenProject,
  onLeave,
  settings,
  onSettings,
  registerLeaveGuard,
}: {
  opened: OpenProject;
  onOpenProject: (id: string) => void;
  onLeave: () => void;
  settings: ModelSettings;
  onSettings: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const online = useOnline();
  const controller = useProjectController(opened, settings, online, registerLeaveGuard);
  const [currentView, setCurrentView] = useState(false);
  const [view, setView] = useState<'paper' | 'final-outline' | 'check'>();
  const {
    data,
    instruction,
    changeInstruction,
    commitInstruction,
    source,
    openSource,
    regeneration,
    openRegeneration,
    error,
    busy,
    stage,
    operationKind,
    session,
    image,
    persistRevision,
    generate,
    reanalyze,
    reanalysis,
    openReanalysis,
    confirmOutline,
    discardOutline,
    refreshOutline,
    outlineIssues,
    restore,
    cancelTask,
    exportPresentation,
    registerEditorLeave,
    resource,
  } = controller;
  const completed = Checkpoints.indexOf(data.project.checkpoint);
  async function switchStep(next: 'paper' | 'outline' | 'slides' | 'check') {
    if (busy || source || regeneration || reanalysis || !(await refreshOutline())) return;
    if (next === 'paper') setView('paper');
    else if (next === 'outline' && session) setView('final-outline');
    else if (next === 'check') {
      setView('check');
      setCurrentView(false);
    } else {
      setView(undefined);
      setCurrentView(next === 'slides');
    }
  }
  const selectedStep =
    view === 'paper'
      ? 'paper'
      : view === 'final-outline'
        ? 'outline'
        : view === 'check'
          ? 'check'
          : session && (!data.plan || currentView)
            ? 'slides'
            : data.plan
              ? 'outline'
              : 'paper';
  const content =
    session && (!data.plan || currentView) ? (
      <Editor
        key={session.current.id}
        session={session}
        readOnly={busy && operationKind === 'restore'}
        resourceAvailable={!!resource}
        registerLeaveGuard={registerEditorLeave}
        onRegenerate={() => openRegeneration(true)}
        onReanalyze={() => openReanalysis(true)}
        onRestore={data.project.previousDeckId ? restore : undefined}
        taskStatus={
          busy
            ? operationKind === 'restore'
              ? '正在恢复上一版…'
              : operationKind === 'reanalysis'
                ? '正在创建重新分析项目…'
                : `正在重生成：${stage || '规划汇报结构'}…`
            : undefined
        }
        onCancelTask={operationKind === 'regenerate' ? cancelTask : undefined}
        externalError={error}
        paper={data.paper}
        image={image}
        name={data.project.name}
        initialSlideId={data.project.lastOpenedSlideId}
        onLeave={onLeave}
        onSettings={onSettings}
        aiSettings={settings}
        aiProjectId={data.project.id}
        aiPreferences={data.project.preferences}
        aiPersistRevision={persistRevision}
        notice="请核对主要结论、图例和裁图边缘；自动识别的图源可能需要调整。"
        onSelection={async (id) => {
          await updateProject(data.project.id, { lastOpenedSlideId: id });
        }}
        onSource={(sourceId, element, _slideId, crop, apply, onDraft) =>
          openSource({ sourceId, element, crop, apply, onDraft })
        }
        onExport={exportPresentation}
      />
    ) : data.plan ? (
      <OutlineSummary
        key={data.plan.id}
        plan={data.plan}
        controller={controller}
        busy={busy}
        onGenerate={() => void generate()}
        onBack={onLeave}
        onConfirm={confirmOutline}
        issues={outlineIssues!}
        error={error}
        onCancel={cancelTask}
        canGenerate={!!settings.apiKey.trim() && online && !!resource}
        stale={!!data.candidateStale}
        onDiscard={data.planRecord?.mode === 'regeneration' ? discardOutline : undefined}
        onCurrent={session ? () => setCurrentView(true) : undefined}
      />
    ) : (
      <main className="mx-auto max-w-[1080px] px-5 py-6">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          <IconButton label="返回首页" disabled={busy} onClick={onLeave}>
            <ArrowLeft size={16} />
          </IconButton>
          <Brand />
          <h1 className="min-w-0 flex-1 truncate text-sm">{data.project.name}</h1>
          <IconButton label="模型设置" disabled={busy} onClick={onSettings}>
            <Settings size={17} />
          </IconButton>
        </header>
        <section className="mx-auto max-w-[760px] py-12">
          <p className="flex items-center gap-3 text-sm text-muted">
            <FileText size={20} />
            已保存：{data.asset?.name ?? '原 PDF 缺失'}
          </p>
          {data.project.checkpoint === 'paper-ready' && (
            <PaperUnderstanding
              paper={data.paper}
              strategyId={data.project.preferences.strategyId}
              image={image}
              sourceAvailable={!!resource}
              onSource={(sourceId) => openSource({ sourceId, crop: false })}
            />
          )}
          <label className="mt-10 block text-sm font-medium" htmlFor="instruction">
            你希望怎么汇报这篇论文？（可选）
          </label>
          <textarea
            id="instruction"
            className={`${inputClass} mt-3 min-h-36 resize-y`}
            placeholder="例如：中文，15 页左右，重点讲结果和创新点"
            value={instruction}
            disabled={busy || data.project.checkpoint === 'deck-plan-ready'}
            onChange={(event) => changeInstruction(event.target.value)}
            onBlur={commitInstruction}
          />
          {(busy || completed > 0) && (
            <ol className="mt-6 space-y-3 border-y border-line py-5">
              {GENERATION_STEPS.map((label, index) => (
                <li
                  key={label}
                  className={`flex items-center gap-3 text-sm ${index < completed ? 'text-success' : index === completed ? 'text-ink' : 'text-muted'}`}
                >
                  {index < completed ? (
                    <Check size={16} />
                  ) : busy && index === completed ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Circle size={16} />
                  )}
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          )}
          {!busy && completed > 0 && completed < 3 && (
            <p className="mt-4 text-sm text-muted">下次从“{GENERATION_STEPS[completed]}”继续，已完成的步骤已保存。</p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {!resource && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              原 PDF 缺失，请保留项目中的可读内容。
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {busy ? (
              <>
                <span role="status" className="text-sm text-muted">
                  {stage}…
                </span>
                <Button onClick={cancelTask}>
                  <X size={15} />
                  取消
                </Button>
              </>
            ) : (
              <>
                {data.paper.pages.length > 0 && (
                  <>
                    <span className="text-sm text-success">已解析 {data.paper.pages.length} 页</span>
                    <Button
                      disabled={!resource || !data.paper.sources.length}
                      onClick={() => openSource({ sourceId: data.paper.sources[0].id, crop: false })}
                    >
                      <FileText size={15} />
                      查看论文
                    </Button>
                    {data.project.checkpoint === 'paper-ready' && !data.project.currentDeckId && (
                      <Button
                        disabled={busy || !resource || !settings.apiKey || !online}
                        onClick={() => openReanalysis(true)}
                      >
                        重新分析
                      </Button>
                    )}
                  </>
                )}
                <Button primary disabled={!resource || !settings.apiKey || !online} onClick={() => void generate()}>
                  <Play size={15} />
                  {data.project.checkpoint === 'paper-ready'
                    ? '生成学术大纲'
                    : error
                      ? '重试当前步骤'
                      : completed > 0
                        ? '继续分析论文'
                        : '分析论文'}
                </Button>
              </>
            )}
          </div>
          {!online && (
            <p role="status" className="mt-4 text-sm text-muted">
              当前离线，联网后可继续生成；本地项目仍可使用。
            </p>
          )}
          {!settings.apiKey && !busy && (
            <div className="mt-4 flex items-center justify-end gap-3 text-xs text-muted">
              <span>尚未配置模型 Key</span>
              <Button onClick={onSettings}>模型设置</Button>
            </div>
          )}
          {!!data.paper.figures.length && !busy && (
            <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-4">
              {data.paper.figures.map((figure) => (
                <Button key={figure.id} onClick={() => openSource({ sourceId: figure.sourceId, crop: false })}>
                  <FileText size={14} />
                  {figure.label ?? 'Figure'}
                </Button>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  return (
    <>
      {completed >= 3 && (
        <nav aria-label="项目步骤" className="border-b border-line bg-white px-5 py-2">
          <div role="tablist" aria-label="项目步骤" className="mx-auto flex max-w-[1080px] flex-wrap gap-1">
            {(['paper', 'outline', 'slides', 'check'] as const).map((step, index) => (
              <button
                key={step}
                type="button"
                role="tab"
                aria-selected={selectedStep === step}
                disabled={
                  busy ||
                  (step === 'outline' && !data.plan && !session) ||
                  ((step === 'slides' || step === 'check') && !session)
                }
                onClick={() => void switchStep(step)}
                className={`min-h-10 rounded px-3 py-2 text-sm disabled:opacity-45 ${selectedStep === step ? 'bg-accent/10 font-medium text-accent' : 'text-muted'}`}
              >
                {index + 1} · {{ paper: '论文理解', outline: '学术大纲', slides: '幻灯片', check: '检查与导出' }[step]}
              </button>
            ))}
          </div>
        </nav>
      )}
      {session && data.plan && currentView && !view && (
        <div className="flex items-center justify-end gap-3 border-b border-line px-5 py-2 text-sm">
          <span>候选大纲已保存</span>
          <Button
            onClick={() => {
              void refreshOutline().then((ready) => {
                if (ready) setCurrentView(false);
              });
            }}
          >
            查看候选大纲
          </Button>
        </div>
      )}
      <div hidden={!!view}>{content}</div>
      {view && (
        <main className="mx-auto max-w-[1080px] px-5 py-6">
          <header className="flex items-center gap-3 border-b border-line pb-5">
            <IconButton label="返回首页" disabled={busy} onClick={onLeave}>
              <ArrowLeft size={16} />
            </IconButton>
            <Brand />
            <h1 className="min-w-0 flex-1 truncate text-sm">{data.project.name}</h1>
            <IconButton label="模型设置" disabled={busy} onClick={onSettings}>
              <Settings size={17} />
            </IconButton>
          </header>
          <div className="mx-auto max-w-[760px] py-6">
            {view === 'check' && session ? (
              <CheckExport
                deck={session.current}
                paper={data.paper}
                resourceAvailable={!!resource}
                exporting={busy}
                onExport={() => void exportPresentation(session.current)}
              />
            ) : view === 'paper' ? (
              <PaperUnderstanding
                paper={data.paper}
                strategyId={data.project.preferences.strategyId}
                image={image}
                sourceAvailable={!!resource}
                onSource={(sourceId) => openSource({ sourceId, crop: false })}
              />
            ) : (
              session && <FinalOutline deck={session.current} paper={data.paper} />
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                disabled={busy || !resource || !online || !settings.apiKey.trim()}
                onClick={() => openReanalysis(true)}
              >
                {session ? '在新项目中重新分析同一论文' : '重新分析'}
              </Button>
              {data.plan && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setView(undefined);
                    setCurrentView(false);
                  }}
                >
                  {session ? '查看候选大纲' : '查看学术大纲'}
                </Button>
              )}
              {session ? (
                <Button onClick={() => void switchStep('slides')}>返回幻灯片</Button>
              ) : (
                !data.plan && (
                  <Button
                    primary
                    disabled={busy || !resource || !online || !settings.apiKey.trim()}
                    onClick={() => {
                      setView(undefined);
                      void generate();
                    }}
                  >
                    <Play size={15} />
                    生成学术大纲
                  </Button>
                )
              )}
            </div>
          </div>
        </main>
      )}
      {source && (
        <SourceDialog
          paper={data.paper}
          resource={resource}
          selection={source}
          readOnly={busy}
          onClose={() => openSource(undefined)}
        />
      )}
      {regeneration && (
        <RegenerateDialog
          instruction={data.project.preferences.instruction}
          disabled={!online || !settings.apiKey.trim()}
          onClose={() => openRegeneration(false)}
          onStart={(value) => {
            setCurrentView(false);
            void generate(value);
          }}
        />
      )}
      {reanalysis && (
        <RegenerateDialog
          instruction={data.project.preferences.instruction}
          disabled={!online || !settings.apiKey.trim() || !resource}
          onClose={() => openReanalysis(false)}
          onStart={(value) =>
            void reanalyze(value).then((id) => {
              if (id) onOpenProject(id);
              else setView(undefined);
            })
          }
          reanalysis
          hasPlan={!!data.plan}
          newProject={!!data.project.currentDeckId}
        />
      )}
    </>
  );
}

function OutlineSummary({
  plan,
  controller,
  busy,
  onGenerate,
  onBack,
  onConfirm,
  issues,
  error,
  onCancel,
  canGenerate,
  stale,
  onDiscard,
  onCurrent,
}: {
  plan: import('../../modules/outline/outline.schema').DeckPlan;
  controller: ReturnType<typeof useProjectController>;
  busy: boolean;
  onGenerate: () => void;
  onBack: () => void;
  onConfirm: (warningsAccepted: boolean) => Promise<void>;
  issues: import('../../modules/outline/narrativeRules').NarrativeValidation;
  error: string;
  onCancel: () => void;
  canGenerate: boolean;
  stale: boolean;
  onDiscard?: () => Promise<void>;
  onCurrent?: () => void;
}) {
  const [acceptedRevision, setAcceptedRevision] = useState<number>();
  const [dirty, setDirty] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<import('../../modules/outline/narrativeRules').NarrativeIssue>();
  const warningsAccepted = acceptedRevision === plan.revision;
  const confirmed = plan.status === 'confirmed';
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-6">
      <header className="flex items-center gap-3 border-b border-line pb-5">
        <IconButton label="返回首页" disabled={busy || dirty} onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <Brand />
        <h1 className="min-w-0 flex-1 truncate text-sm">学术大纲</h1>
        {onCurrent && (
          <Button disabled={busy || dirty} onClick={onCurrent}>
            当前文稿
          </Button>
        )}
      </header>
      <section className="py-6">
        <h2 className="text-lg font-semibold">{plan.title}</h2>
        {onDiscard && <p className="mt-2 text-sm">{stale ? '候选大纲已过期' : '候选重生成大纲'}</p>}
        <p className="mt-2 text-sm text-muted">
          {confirmed ? '大纲已确认，可以生成幻灯片。' : '请检查并确认大纲后再生成幻灯片。'}
        </p>
        <OutlineEditor
          plan={plan}
          paper={controller.data.paper}
          disabled={busy || stale}
          edit={controller.editOutline}
          canUndo={controller.outlineCanUndo}
          canRedo={controller.outlineCanRedo}
          onDirty={setDirty}
          registerLeave={controller.registerOutlineLeave}
          onSource={(sourceId) => controller.openSource({ sourceId, crop: false })}
          issue={selectedIssue}
        />
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        {[...issues.errors, ...issues.warnings].map((issue) => (
          <button
            type="button"
            disabled={dirty}
            onClick={() => setSelectedIssue(issue)}
            key={`${issue.code}-${issue.slideId ?? issue.sectionId ?? issue.claimId ?? issue.figureId ?? issue.message}`}
            className={`mt-2 block text-left text-sm ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}
          >
            {issue.message}
          </button>
        ))}
        {!!issues.warnings.length && !confirmed && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={warningsAccepted}
              onChange={(event) => setAcceptedRevision(event.target.checked ? plan.revision : undefined)}
            />
            已核对警告，继续确认
          </label>
        )}
        <div className="mt-7 flex flex-wrap justify-end gap-3">
          {!onCurrent && (
            <Button disabled={busy || dirty || !canGenerate} onClick={() => controller.openReanalysis(true)}>
              重新分析
            </Button>
          )}
          {onDiscard && (
            <Button disabled={busy || dirty} onClick={() => void onDiscard()}>
              <X size={15} />
              放弃候选
            </Button>
          )}
          {busy && (
            <Button onClick={onCancel}>
              <X size={15} />
              取消
            </Button>
          )}
          {!confirmed && (
            <Button
              primary
              disabled={
                busy || dirty || stale || !!issues.errors.length || (!!issues.warnings.length && !warningsAccepted)
              }
              onClick={() => void onConfirm(warningsAccepted)}
            >
              <Check size={15} />
              确认大纲
            </Button>
          )}
          <Button primary disabled={!confirmed || busy || dirty || stale || !canGenerate} onClick={onGenerate}>
            <Play size={15} />
            生成幻灯片
          </Button>
        </div>
      </section>
    </main>
  );
}

function RegenerateDialog({
  instruction,
  disabled,
  onClose,
  onStart,
  reanalysis = false,
  hasPlan = false,
  newProject = false,
}: {
  instruction: string;
  disabled: boolean;
  onClose: () => void;
  onStart: (instruction: string) => void;
  reanalysis?: boolean;
  hasPlan?: boolean;
  newProject?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(instruction);
  const mode = reanalysis ? (newProject ? 'copy' : 'reanalyze') : 'regenerate';
  const copy = {
    regenerate: {
      title: '重新生成整套 PPT',
      description: '使用已有论文分析重新组织汇报，成功后保留当前文稿作为上一版。',
      submit: '开始重生成',
    },
    copy: {
      title: '在新项目中重新分析同一论文',
      description: '复制原 PDF 和完整图源到新项目，打开后可继续分析。原项目、当前版、上一版及候选大纲均保留。',
      submit: '创建并打开新项目',
    },
    reanalyze: {
      title: '重新分析论文',
      description: hasPlan
        ? '重新分析成功后，原大纲及其确认状态将失效。失败或取消会保留原论文理解和大纲。'
        : '复用原论文和图源重新分析，成功后替换论文理解。失败或取消会保留原成果。',
      submit: '开始重新分析',
    },
  }[mode];
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={reanalysis ? '重新分析论文' : '重新生成整套 PPT'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto w-[min(600px,94vw)] max-w-none rounded-md border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-black/35"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        <IconButton label={reanalysis ? '关闭重新分析' : '关闭重生成'} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <p className="mt-4 text-sm text-muted">{copy.description}</p>
      <label className="mt-5 block text-sm" htmlFor="regeneration-instruction">
        你希望怎么汇报这篇论文？
      </label>
      <textarea
        id="regeneration-instruction"
        aria-label={reanalysis ? '重新分析要求' : '重生成要求'}
        className={`${inputClass} mt-2 min-h-36`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="例如：中文，15 页左右，重点讲结果和创新点"
      />
      {disabled && <p className="mt-3 text-xs text-muted">原 PDF 可用、联网并配置模型 Key 后可继续。</p>}
      <footer className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button primary disabled={disabled} onClick={() => onStart(value)}>
          {copy.submit}
        </Button>
      </footer>
    </dialog>
  );
}
