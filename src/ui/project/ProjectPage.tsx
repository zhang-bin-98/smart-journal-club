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

export function ProjectPage({
  id,
  onLeave,
  settings,
  onSettings,
  registerLeaveGuard,
}: {
  id: string;
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
  onLeave,
  settings,
  onSettings,
  registerLeaveGuard,
}: {
  opened: OpenProject;
  onLeave: () => void;
  settings: ModelSettings;
  onSettings: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const online = useOnline();
  const controller = useProjectController(opened, settings, online, registerLeaveGuard);
  const [currentView, setCurrentView] = useState(false);
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
  const content =
    session && (!data.plan || currentView) ? (
      <Editor
        key={session.current.id}
        session={session}
        readOnly={busy && operationKind === 'restore'}
        resourceAvailable={!!resource}
        registerLeaveGuard={registerEditorLeave}
        onRegenerate={() => openRegeneration(true)}
        onRestore={data.project.previousDeckId ? restore : undefined}
        taskStatus={
          busy
            ? operationKind === 'restore'
              ? '正在恢复上一版…'
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
            <section className="mt-8 space-y-5" aria-label="论文理解">
              <h2 className="text-lg font-semibold">论文理解</h2>
              <h3 className="text-base font-medium">{data.paper.metadata.title}</h3>
              {(['question', 'studyDesign', 'mainFindings', 'limitations'] as const).map((topic) => (
                <div key={topic}>
                  <h4 className="text-sm font-semibold">
                    {
                      { question: '研究问题', studyDesign: '研究设计', mainFindings: '主要发现', limitations: '局限' }[
                        topic
                      ]
                    }
                  </h4>
                  {data.paper.story?.[topic].map((point) => (
                    <p key={`${topic}-${point.text}`} className="mt-2 text-sm">
                      {point.text}
                    </p>
                  ))}
                </div>
              ))}
            </section>
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
      {session && data.plan && currentView && (
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
      {content}
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
}: {
  instruction: string;
  disabled: boolean;
  onClose: () => void;
  onStart: (instruction: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(instruction);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="重新生成整套 PPT"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto w-[min(600px,94vw)] max-w-none rounded-md border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-black/35"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">重新生成整套 PPT</h2>
        <IconButton label="关闭重生成" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <p className="mt-4 text-sm text-muted">使用已有论文分析重新组织汇报，成功后保留当前文稿作为上一版。</p>
      <label className="mt-5 block text-sm" htmlFor="regeneration-instruction">
        你希望怎么汇报这篇论文？
      </label>
      <textarea
        id="regeneration-instruction"
        aria-label="重生成要求"
        className={`${inputClass} mt-2 min-h-36`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="例如：中文，15 页左右，重点讲结果和创新点"
      />
      {disabled && <p className="mt-3 text-xs text-muted">联网并配置模型 Key 后可开始重生成。</p>}
      <footer className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button primary disabled={disabled} onClick={() => onStart(value)}>
          开始重生成
        </Button>
      </footer>
    </dialog>
  );
}
