import { useState } from 'react';
import type { SourceReference } from '../../modules/paper/model';
import type { ModelSettings } from '../../app/settings/modelSettings';
import { pageBounds } from '../../modules/paper/figureGeometry';
import { Button, inputClass } from '../controls';
import { CropPreview } from './BoxEditor';
import { PaperAssistant } from './PaperAssistant';
import type { FigureReviewController } from './useFigureReview';
export function FigureInspector({
  controller,
  settings,
}: {
  controller: FigureReviewController;
  settings: ModelSettings;
}) {
  const {
    session,
    state,
    resources,
    setPanelId,
    mode,
    label,
    setLabel,
    association,
    setAssociation,
    rightWidth,
    ai,
    original,
    setOriginal,
    commit,
    cancel,
    paper,
    current,
    panel,
    source,
    previewBox,
    concerns,
    captions,
    associated,
    captionSources,
    evidence,
    busy,
  } = controller;
  const [location, setLocation] = useState<{ target?: string; source: SourceReference }>();
  const located = location?.target === source?.id ? location?.source : undefined;
  const setLocated = (value?: SourceReference) =>
    setLocation(value ? { target: source?.id, source: value } : undefined);
  return (
    <aside className="flex shrink-0 flex-col bg-white" style={{ width: rightWidth }}>
      <div className="flex shrink-0 items-center justify-between border-b border-line p-4">
        <h2 className="font-medium">
          {current?.figure.label || '图源预览'} {panel?.label}
        </h2>
        <Button disabled={!current} onClick={() => setOriginal(!original)}>
          {original ? '返回裁图' : '定位原页'}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {source && previewBox && (
          <CropPreview
            resources={resources}
            documentId={located?.documentId ?? source.documentId}
            pageNumber={located?.pageNumber ?? source.pageNumber}
            bbox={located ? (located.bbox ?? pageBounds) : original ? pageBounds : previewBox}
          />
        )}
        {located && (
          <div className="mt-2 text-xs">
            <p>
              {paper.documents.find((doc) => doc.id === located.documentId)?.fileName} · 第 {located.pageNumber} 页
            </p>
            <Button onClick={() => setLocated(undefined)}>返回当前裁图</Button>
          </div>
        )}
        {current && (
          <div className="mt-3 flex flex-wrap gap-2">
            {current.region.panels.map((item) => (
              <Button
                key={item.id}
                primary={item.id === panel?.id}
                disabled={state.dirty}
                onClick={() => controller.select(current.region.id, item.id)}
              >
                {item.label || '未标号 Panel'}
              </Button>
            ))}
          </div>
        )}
        {controller.impact.length > 0 && (
          <details className="mt-4 rounded border border-line p-3 text-xs">
            <summary className="cursor-pointer">受影响的已有讲稿 / 页面（{controller.impact.length}）</summary>
            <p className="mt-2 leading-relaxed">
              图源修改保存为独立底稿。以下稿件及其讲稿仍使用原图源，可继续查看与导出。
            </p>
            {controller.impact.map((item) => (
              <p key={item.id} className="mt-2">
                {item.label} · 第 {item.page} 页 · {item.title}
              </p>
            ))}
          </details>
        )}
        {panel && current && (
          <div className="mt-4 space-y-2">
            <label className="block text-xs">
              Panel 标签
              <input
                aria-label="Panel 标签"
                disabled={
                  !!controller.title || controller.association !== undefined || !!controller.draft || mode === 'panel'
                }
                className={`${inputClass} mt-1`}
                value={label ?? panel.label ?? ''}
                onChange={(event) => {
                  session.register('label');
                  setLabel(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter' && label !== undefined)
                    void commit({ kind: 'label', regionId: current.region.id, panelId: panel.id, label });
                  if (event.key === 'Escape') cancel();
                }}
              />
            </label>
            {label !== undefined && mode !== 'panel' && (
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void commit({ kind: 'label', regionId: current.region.id, panelId: panel.id, label })}
                >
                  保存标签
                </Button>
                <Button disabled={busy} onClick={cancel}>
                  取消
                </Button>
              </div>
            )}
            <Button
              disabled={busy || state.dirty}
              onClick={() =>
                void commit({ kind: 'delete-panel', regionId: current.region.id, panelId: panel.id }).then((saved) => {
                  if (saved) setPanelId(undefined);
                })
              }
            >
              删除当前 Panel
            </Button>
          </div>
        )}
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="font-medium">对应图注与公共说明</h3>
          {captionSources.map((item) => (
            <p key={item.id} className="mt-3 text-xs leading-relaxed">
              {associated.find((link) => link.sourceId === item.id)?.role === 'shared' && (
                <span className="text-accent">公共说明 · </span>
              )}
              {item.textQuote}
            </p>
          ))}
          {!captionSources.length && (
            <p className="mt-2 text-xs text-muted">
              {current?.figure.caption || '尚无可靠关联，可展开原文并调整关联。'}
            </p>
          )}
          {!panel && current?.figure.description && (
            <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed">{current.figure.description}</p>
          )}
          {panel?.description && (
            <p className="mt-3 whitespace-pre-wrap rounded bg-panel p-3 text-xs leading-relaxed">
              中文解释（模型）：{panel.description}
            </p>
          )}
          {panel && (
            <Button className="mt-3" disabled={busy || state.dirty} onClick={() => setAssociation([...associated])}>
              调整关联
            </Button>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs">展开完整图注</summary>
            <div className="mt-3 text-xs leading-relaxed">
              {captions.map((item) => (
                <span
                  key={item.id}
                  className={associated.some((link) => link.sourceId === item.id) ? 'bg-amber-100' : ''}
                >
                  {item.textQuote}{' '}
                </span>
              ))}
            </div>
          </details>
        </section>
        {association && panel && current && (
          <div className="mt-4 rounded border border-line p-3">
            <p className="mb-2 text-xs">选择图注片段与适用角色</p>
            {captions.map((item) => {
              const link = association.find((link) => link.sourceId === item.id);
              return (
                <label key={item.id} className="mb-3 block text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    checked={!!link}
                    onChange={(event) => {
                      session.register('association');
                      setAssociation(
                        event.target.checked
                          ? [...association, { sourceId: item.id, role: 'panel' }]
                          : association.filter((link) => link.sourceId !== item.id),
                      );
                    }}
                  />
                  {item.textQuote}
                  {link && (
                    <select
                      aria-label="图注关联角色"
                      value={link.role}
                      onChange={(event) => {
                        session.register('association');
                        setAssociation(
                          association.map((other) =>
                            other.sourceId === item.id
                              ? { ...other, role: event.target.value as 'panel' | 'shared' }
                              : other,
                          ),
                        );
                      }}
                    >
                      <option value="panel">专属说明</option>
                      <option value="shared">公共说明</option>
                    </select>
                  )}
                </label>
              );
            })}
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void commit({
                    kind: 'associate',
                    regionId: current.region.id,
                    panelId: panel.id,
                    links: association,
                  })
                }
              >
                应用关联
              </Button>
              <Button disabled={busy} onClick={cancel}>
                取消
              </Button>
            </div>
          </div>
        )}
        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer text-xs">正文证据与发现</summary>
          {evidence.map((item) => (
            <div key={item.id} className="mt-3 text-xs leading-relaxed">
              <p>{item.summary}</p>
              {paper.sources
                .filter((source) => item.sourceIds.includes(source.id) && source.textQuote)
                .map((source) => (
                  <button
                    key={source.id}
                    className="mt-2 block text-left text-accent underline"
                    onClick={() => setLocated(source)}
                  >
                    {source.textQuote} · 第 {source.pageNumber} 页
                  </button>
                ))}
            </div>
          ))}
          {!evidence.length && <p className="mt-3 text-xs text-muted">暂无确定的正文关联；原文事实仍完整保留。</p>}
        </details>
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="text-xs font-medium">切分疑点</h3>
          {current &&
            [...new Set(concerns(current.figure.id))].map((issue) => (
              <p key={issue} className="mt-2 text-xs leading-relaxed text-amber-700">
                {issue}
              </p>
            ))}
          <p className="mt-3 text-xs leading-relaxed text-muted">
            共享图例允许适度重叠。请对照原页检查坐标轴、图例与比例尺是否完整。
          </p>
        </section>
        {ai && (
          <PaperAssistant
            paper={paper}
            documentId={source?.documentId}
            pageNumber={source?.pageNumber}
            figureId={current?.figure.id}
            panelId={panel?.id}
            settings={settings}
          />
        )}
      </div>
    </aside>
  );
}
