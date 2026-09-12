import { useState } from 'react';
import type { RegisterLeaveGuard } from '../../app/activity';
import type { ModelSettings } from '../../app/settings/modelSettings';
import type { WorkspaceStep } from '../../modules/project/model';
import { paragraphText, uncoveredClaims, type ContentCommand } from '../../modules/presentation/content';
import { prompts } from '../../shared/llm/prompts';
import { Button, Brand, inputClass } from '../controls';
import { WorkspaceDivider } from '../paper/PagePreview';
import { useSpeechController } from './useSpeechController';
import { SpeechAi } from './SpeechAi';
import { SpeechEvidence } from './SpeechEvidence';
export function SpeechPage({
  id,
  settings,
  onSettings,
  onLeave,
  onStep,
  autoStart,
  onStarted,
  registerLeaveGuard,
}: {
  id: string;
  settings: ModelSettings;
  onSettings: () => void;
  onLeave: () => void;
  onStep: (step: WorkspaceStep) => void;
  autoStart?: boolean;
  onStarted?: () => void;
  registerLeaveGuard?: RegisterLeaveGuard;
}) {
  const c = useSpeechController({ id, settings, autoStart, onStarted, registerLeaveGuard });
  const [selectedId, setSelectedId] = useState<string>();
  const [sectionId, setSectionId] = useState<string>();
  const [query, setQuery] = useState('');
  const [leftWidth, setLeftWidth] = useState(230);
  const [rightWidth, setRightWidth] = useState(370);
  const [ai, setAi] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [drag, setDrag] = useState<{ kind: 'section' | 'paragraph'; id: string }>();
  const [replace, setReplace] = useState(false);
  const data = c.state.data;
  if (!data)
    return (
      <main className="p-6">
        <Button onClick={onLeave}>返回项目列表</Button>
        <p role={c.error ? 'alert' : 'status'}>{c.error || '正在打开讲稿…'}</p>
        {c.error && <Button onClick={() => void c.act(c.session.load)}>重试读取</Button>}
      </main>
    );
  const content = data.target?.content;
  const selected = content?.speechParagraphs.find((p) => p.id === selectedId) ?? content?.speechParagraphs[0];
  const activeSection = sectionId ?? selected?.sectionId ?? content?.sections[0]?.id;
  const disabled = c.running || c.state.saving || data.stale;
  const missing = content ? uncoveredClaims(content, data.paper) : [];
  const command = (value: ContentCommand) => void c.act(() => c.session.commit([value]));
  function jump(id: string, section = false) {
    document.getElementById((section ? 'chapter-' : 'paragraph-') + id)?.scrollIntoView({ block: 'start' });
    if (section) setSectionId(id);
    else {
      setSelectedId(id);
      setSectionId(undefined);
    }
  }
  function addParagraph(chapter: string, afterId: string | null) {
    const paragraphId = crypto.randomUUID();
    const segmentId = crypto.randomUUID();
    command({
      type: 'add-paragraph',
      afterId,
      paragraph: { id: paragraphId, sectionId: chapter, purpose: '', segmentIds: [segmentId] },
      segments: [{ id: segmentId, paragraphId, text: '', claimIds: [], sourceIds: [] }],
    });
    setSelectedId(paragraphId);
  }
  function editValue(target: string, fallback: string, field: string) {
    const draft = c.drafts[target]?.command;
    if (!draft) return fallback;
    if (draft.type === 'update-section') return (draft.patch as Record<string, string>)[field] ?? fallback;
    if (draft.type === 'update-paragraph') return (draft as unknown as Record<string, string>)[field] ?? fallback;
    return fallback;
  }
  return (
    <div className="flex h-dvh min-w-[1100px] flex-col overflow-hidden bg-canvas text-sm text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button onClick={onLeave}>返回项目列表</Button>
          <Brand />
          <span className="max-w-72 truncate">{data.project.name}</span>
          <span role="status" className="text-xs text-muted">
            {c.state.saving ? '正在保存…' : c.state.dirty ? '未保存输入' : '已保存'}
            {data.target?.kind === 'deck' ? ' · 当前稿讲述' : ''}
          </span>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSettings}>模型配置</Button>
          <Button
            primary
            disabled={!data.project.currentDeckId || c.running}
            title={data.project.currentDeckId ? '打开已有幻灯片' : '幻灯片生成尚未开放，当前可继续编辑讲稿'}
            onClick={() => void c.act(async () => onStep('slides'))}
          >
            {data.project.currentDeckId ? '查看已有幻灯片' : '下一步：生成幻灯片'}
          </Button>
        </div>
      </header>
      <nav
        aria-label="项目步骤"
        className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-white px-5 text-xs"
      >
        <button onClick={() => onStep('paper-analysis')}>1 论文分析</button>
        <button onClick={() => onStep('figure-review')}>2 图源核对</button>
        <span className="font-semibold text-accent">3 大纲与演讲稿</span>
        <button disabled={!data.project.currentDeckId} onClick={() => onStep('slides')}>
          4 幻灯片
        </button>
        <span className="ml-auto text-muted">{c.stage || '完整讲述 · 多图证据 · 自动保存'}</span>
      </nav>
      {(c.error || c.state.error) && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700"
        >
          <span>{c.error || c.state.error}</span>
          {c.state.dirty && (
            <>
              <Button onClick={() => void c.act(async () => {})}>重试保存</Button>
              <Button onClick={() => void c.discard()}>取消未保存输入</Button>
            </>
          )}
        </div>
      )}
      {data.stale && (
        <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3">
          原讲稿保留为只读，论文或项目偏好已变化。请确认图源后重新生成。
        </p>
      )}
      {c.running && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-5 py-2">
          <p className="flex-1">{c.stage}</p>
          <Button onClick={() => c.stop(true)}>暂停生成</Button>
          <Button onClick={() => c.stop(false)}>取消生成</Button>
        </div>
      )}
      {c.paused && content && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-5 py-2">
          <span className="flex-1">生成已暂停，已保存的讲稿仍保留。</span>
          <Button onClick={() => void c.act(c.generate)}>继续生成讲稿</Button>
        </div>
      )}
      <main className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col bg-white" style={{ width: leftWidth }}>
          <div className="border-b border-line p-3">
            <input
              aria-label="搜索章节"
              className={inputClass}
              placeholder="搜索章节"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {content?.sections
              .filter((s) => s.title.includes(query))
              .map((s, index) => (
                <div
                  key={s.id}
                  draggable={!disabled}
                  onDragStart={() => setDrag({ kind: 'section', id: s.id })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag?.kind === 'section' && drag.id !== s.id)
                      command({ type: 'move-section', sectionId: drag.id, afterId: s.id });
                    setDrag(undefined);
                  }}
                  className={
                    'mb-2 rounded border p-3 ' + (s.id === activeSection ? 'border-accent bg-accent/5' : 'border-line')
                  }
                >
                  <button className="w-full text-left font-medium" onClick={() => jump(s.id, true)}>
                    {s.title || '未命名章节'}
                  </button>
                  <p className="mt-1 text-xs text-muted">{s.track === 'main' ? '主线' : '补充'}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={disabled || index === 0}
                      onClick={() =>
                        command({
                          type: 'move-section',
                          sectionId: s.id,
                          afterId: content.sections[index - 2]?.id ?? null,
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      disabled={disabled || index === content.sections.length - 1}
                      onClick={() =>
                        command({ type: 'move-section', sectionId: s.id, afterId: content.sections[index + 1].id })
                      }
                    >
                      下移
                    </button>
                  </div>
                </div>
              ))}
          </div>
          <div className="shrink-0 border-t border-line p-3">
            <Button
              disabled={!content || disabled}
              onClick={() =>
                command({
                  type: 'add-section',
                  section: { id: crypto.randomUUID(), kind: 'custom', track: 'main', title: '新章节', purpose: '' },
                  afterId: content?.sections.at(-1)?.id ?? null,
                })
              }
            >
              ＋ 添加章节
            </Button>
          </div>
        </aside>
        <WorkspaceDivider label="调整章节目录宽度" width={leftWidth} min={190} max={330} onChange={setLeftWidth} />
        <section className="flex min-w-[360px] flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-white p-3">
            <Button disabled={!c.state.canUndo || disabled} onClick={() => void c.act(c.session.undo)}>
              撤销
            </Button>
            <Button disabled={!c.state.canRedo || disabled} onClick={() => void c.act(c.session.redo)}>
              重做
            </Button>
            <Button onClick={() => setCoverage(!coverage)}>
              发现覆盖 {data.paper.claims.length - missing.length}/{data.paper.claims.length}
            </Button>
            {!data.project.currentDeckId && (
              <Button
                disabled={c.running || c.state.dirty}
                onClick={() => (content || data.legacyPlan ? setReplace(true) : void c.generate())}
              >
                重新生成讲稿
              </Button>
            )}
          </div>
          {coverage && content && (
            <div className="max-h-48 shrink-0 overflow-y-auto border-b border-line bg-white p-4 text-xs">
              <p>覆盖按讲述中的发现引用统计，科学对应仍需核对。</p>
              {missing.map((claim) => (
                <p key={claim.id} className="mt-2">
                  {content.omissions.some((o) => o.claimId === claim.id) ? '用户省略：' : '尚未讲述：'}
                  {claim.text}
                </p>
              ))}
              {!missing.length && <p className="mt-2">全部已识别发现均有讲述。</p>}
            </div>
          )}
          <div
            aria-label="连续讲稿正文"
            className="min-h-0 flex-1 overflow-y-auto p-6"
            onScroll={(event) => {
              const top = event.currentTarget.getBoundingClientRect().top + 50;
              const paragraph = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-paragraph]')].find(
                (node) => node.getBoundingClientRect().bottom > top,
              );
              if (paragraph) {
                setSelectedId(paragraph.dataset.paragraph);
                setSectionId(undefined);
              }
            }}
          >
            {!content && (
              <div className="mx-auto max-w-xl space-y-4 rounded border border-line bg-white p-6">
                <h1 className="text-xl font-semibold">生成大纲与完整演讲稿</h1>
                <p>根据已核对图源、原句和全部发现整理讲述，保存后停在本步供你编辑。</p>
                {data.legacyPlan && <p>已有旧页面计划将保留，只有确认重新生成后才替换工作计划；已有稿件不受影响。</p>}
                <Button
                  primary
                  disabled={c.running || !settings.apiKey}
                  onClick={() => (data.legacyPlan ? setReplace(true) : void c.generate())}
                >
                  {c.paused ? '继续生成讲稿' : '生成讲稿'}
                </Button>
              </div>
            )}
            {content && !content.speechParagraphs.length && (
              <p className="mb-5 rounded border border-amber-200 bg-amber-50 p-4">
                旧稿没有保存演讲稿，现有章节和页面保留。可手动添加讲述，系统不会根据页面文字编造正文。
              </p>
            )}
            {content?.sections.map((s) => {
              const peers = content.speechParagraphs.filter((p) => p.sectionId === s.id);
              return (
                <section key={s.id} id={'chapter-' + s.id} className="mx-auto mb-8 max-w-3xl scroll-mt-4">
                  <div className="mb-4 rounded border border-line bg-white p-4">
                    <input
                      aria-label="章节标题"
                      className={inputClass + ' text-lg font-semibold'}
                      value={editValue('section-title:' + s.id, s.title, 'title')}
                      disabled={c.running || data.stale}
                      onChange={(e) =>
                        c.change('section-title:' + s.id, {
                          type: 'update-section',
                          sectionId: s.id,
                          patch: { title: e.target.value },
                        })
                      }
                      onBlur={() => void c.act(async () => {})}
                    />
                    <div className="mt-3 flex gap-2">
                      <select
                        aria-label="章节主线或补充"
                        className={inputClass}
                        disabled={disabled}
                        value={s.track}
                        onChange={(e) =>
                          command({
                            type: 'update-section',
                            sectionId: s.id,
                            patch: { track: e.target.value as 'main' | 'supplement' },
                          })
                        }
                      >
                        <option value="main">主线</option>
                        <option value="supplement">补充</option>
                      </select>
                      <Button disabled={disabled} onClick={() => command({ type: 'delete-section', sectionId: s.id })}>
                        删除章节
                      </Button>
                    </div>
                    <input
                      aria-label="章节目的"
                      className={inputClass + ' mt-3'}
                      placeholder="讲述目的"
                      value={editValue('section-purpose:' + s.id, s.purpose, 'purpose')}
                      disabled={c.running || data.stale}
                      onChange={(e) =>
                        c.change('section-purpose:' + s.id, {
                          type: 'update-section',
                          sectionId: s.id,
                          patch: { purpose: e.target.value },
                        })
                      }
                      onBlur={() => void c.act(async () => {})}
                    />
                  </div>
                  {peers.map((p, index) => (
                    <article
                      key={p.id}
                      id={'paragraph-' + p.id}
                      data-paragraph={p.id}
                      className={
                        'mb-4 scroll-mt-4 rounded border bg-white p-4 ' +
                        (selected?.id === p.id ? 'border-accent' : 'border-line')
                      }
                      onFocus={() => {
                        setSelectedId(p.id);
                        setSectionId(undefined);
                      }}
                      draggable={false}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag?.kind === 'paragraph' && drag.id !== p.id)
                          command({ type: 'move-paragraph', paragraphId: drag.id, sectionId: s.id, afterId: p.id });
                        setDrag(undefined);
                      }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <button
                          aria-label="拖动讲述"
                          draggable={!disabled}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', p.id);
                            e.dataTransfer.effectAllowed = 'move';
                            setDrag({ kind: 'paragraph', id: p.id });
                          }}
                        >
                          ⠿
                        </button>
                        <input
                          aria-label="讲述目的"
                          className={inputClass}
                          value={editValue('purpose:' + p.id, p.purpose, 'purpose')}
                          disabled={c.running || data.stale}
                          onChange={(e) =>
                            c.change('purpose:' + p.id, {
                              type: 'update-paragraph',
                              paragraphId: p.id,
                              purpose: e.target.value,
                            })
                          }
                          onBlur={() => void c.act(async () => {})}
                        />
                      </div>
                      <textarea
                        aria-label="讲稿正文"
                        className={inputClass + ' min-h-40 resize-y leading-7'}
                        rows={Math.max(6, Math.min(18, Math.ceil(paragraphText(content, p.id).length / 40)))}
                        value={editValue('text:' + p.id, paragraphText(content, p.id), 'text')}
                        disabled={c.running || data.stale}
                        onChange={(e) =>
                          c.change('text:' + p.id, {
                            type: 'update-paragraph',
                            paragraphId: p.id,
                            text: e.target.value,
                          })
                        }
                        onBlur={() => void c.act(async () => {})}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <Button
                          disabled={disabled || index === 0}
                          onClick={() =>
                            command({
                              type: 'move-paragraph',
                              paragraphId: p.id,
                              sectionId: s.id,
                              afterId: peers[index - 2]?.id ?? null,
                            })
                          }
                        >
                          段落上移
                        </Button>
                        <Button
                          disabled={disabled || index === peers.length - 1}
                          onClick={() =>
                            command({
                              type: 'move-paragraph',
                              paragraphId: p.id,
                              sectionId: s.id,
                              afterId: peers[index + 1].id,
                            })
                          }
                        >
                          段落下移
                        </Button>
                        <select
                          aria-label="讲述所属章节"
                          className="max-w-36 rounded border border-line p-2"
                          value={s.id}
                          disabled={disabled}
                          onChange={(e) =>
                            command({
                              type: 'move-paragraph',
                              paragraphId: p.id,
                              sectionId: e.target.value,
                              afterId: null,
                            })
                          }
                        >
                          {content.sections.map((chapter) => (
                            <option key={chapter.id} value={chapter.id}>
                              {chapter.title}
                            </option>
                          ))}
                        </select>
                        <Button
                          disabled={disabled}
                          onClick={() => {
                            const text = paragraphText(content, p.id);
                            const match = /[。！？.!?]\s*/.exec(text);
                            if (!match || match.index + match[0].length >= text.length) {
                              c.setError('至少需要两句完整讲述才能拆分。');
                              return;
                            }
                            command({
                              type: 'split-paragraph',
                              paragraphId: p.id,
                              offset: match.index + match[0].length,
                              newParagraphId: crypto.randomUUID(),
                              newSegmentId: crypto.randomUUID(),
                            });
                          }}
                        >
                          拆分讲述
                        </Button>
                        <Button
                          disabled={disabled || !peers[index + 1]}
                          onClick={() =>
                            command({
                              type: 'merge-paragraph',
                              paragraphId: p.id,
                              nextParagraphId: peers[index + 1].id,
                            })
                          }
                        >
                          合并下段
                        </Button>
                        <Button
                          disabled={disabled}
                          onClick={() => command({ type: 'delete-paragraph', paragraphId: p.id })}
                        >
                          删除讲述
                        </Button>
                      </div>
                    </article>
                  ))}
                  <Button disabled={disabled} onClick={() => addParagraph(s.id, peers.at(-1)?.id ?? null)}>
                    ＋ 添加讲述
                  </Button>
                </section>
              );
            })}
          </div>
        </section>
        <WorkspaceDivider
          label="调整证据栏宽度"
          width={rightWidth}
          min={290}
          max={500}
          reverse
          onChange={setRightWidth}
        />
        <aside className="flex shrink-0 flex-col bg-white" style={{ width: rightWidth }}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SpeechEvidence controller={c} selectedId={selected?.id} onSelect={(id) => jump(id)} />
          </div>
          <div className={ai ? 'contents' : 'hidden'}>
            <SpeechAi controller={c} selectedId={selected?.id} settings={settings} />
          </div>
        </aside>
      </main>
      <footer className="flex shrink-0 items-center justify-between border-t border-line bg-white px-5 py-2 text-xs text-muted">
        <span>
          {content?.sections.length ?? 0} 章节 · {content?.speechParagraphs.length ?? 0} 段讲述 ·{' '}
          {c.running ? c.stage : '正文与引用自动保存'}
        </span>
        <Button onClick={() => setAi(!ai)}>{ai ? '收起 AI' : '展开 AI 输入'}</Button>
      </footer>
      {replace && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div role="dialog" aria-label="重新生成讲稿" className="w-[480px] space-y-4 rounded bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">重新生成完整讲稿</h2>
            <p>成功后替换本项目的工作讲稿；失败或取消保留原稿。请先保存需要保留的人工内容。</p>
            <select
              aria-label="叙事策略"
              className={inputClass}
              value={
                c.strategyId ??
                data.record?.generationPreferences.strategyId ??
                data.project.preferences.strategyId ??
                'general'
              }
              onChange={(e) => c.setStrategyId(e.target.value)}
            >
              {prompts.strategies.map((strategy) => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                primary
                onClick={() => {
                  setReplace(false);
                  void c.generate();
                }}
              >
                确认重新生成
              </Button>
              <Button onClick={() => setReplace(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
