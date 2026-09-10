import type { ModelSettings } from '../../app/settings/modelSettings';
import { regionIn } from '../../modules/paper/figureEditing';
import { pageBounds } from '../../modules/paper/figureGeometry';
import { Button, inputClass } from '../controls';
import { BoxEditor } from './BoxEditor';
import { FigureDestinationInput } from './FigureDestination';
import { ProjectDialog } from '../projects/ProjectDialog';

import type { FigureReviewController } from './useFigureReview';
export function FigureDialogs({ controller }: { controller: FigureReviewController; settings?: ModelSettings }) {
  const { session, resources, title, setTitle, moveConfirm, setMoveConfirm, commit, cancel, paper, busy, saveTitle } =
    controller;
  return (
    <>
      {' '}
      {title && !title.regionId && (
        <ProjectDialog title={title.regionId ? '修改当前图块图号 / 归属' : '添加 Figure'} busy={busy} onClose={cancel}>
          <div
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
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
            {!title.regionId && (
              <>
                <div className="my-3 flex gap-3">
                  <select
                    aria-label="添加 Figure 来源文件"
                    className={inputClass}
                    value={title.documentId}
                    onChange={(event) => {
                      session.register('title');
                      setTitle({ ...title, documentId: event.target.value, pageNumber: 1, bbox: undefined });
                    }}
                  >
                    {paper.documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.role === 'primary' ? '主论文' : '补充材料'} · {doc.fileName}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="添加 Figure 页码"
                    type="number"
                    min={1}
                    max={paper.documents.find((doc) => doc.id === title.documentId)?.pageCount}
                    className={`${inputClass} w-20`}
                    value={title.pageNumber}
                    onChange={(event) => {
                      session.register('title');
                      setTitle({
                        ...title,
                        pageNumber: Math.max(
                          1,
                          Math.min(
                            paper.documents.find((doc) => doc.id === title.documentId)?.pageCount ?? 1,
                            Number(event.target.value),
                          ),
                        ),
                        bbox: undefined,
                      });
                    }}
                  />
                </div>
                <div className="max-h-[50vh] overflow-auto">
                  <BoxEditor
                    key={`${title.documentId}:${title.pageNumber}`}
                    resources={resources}
                    documentId={title.documentId}
                    pageNumber={title.pageNumber}
                    frame={pageBounds}
                    boxes={title.bbox ? [{ id: 'new', bbox: title.bbox, label: '新增整图' }] : []}
                    selected="new"
                    adding={!title.bbox}
                    onStart={() => session.register('title')}
                    onDraft={(bbox) => setTitle((old) => old && { ...old, bbox })}
                    onCommit={(bbox) => setTitle((old) => old && { ...old, bbox })}
                    onCancel={cancel}
                  />
                </div>
              </>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              选择已有图号将当前单页图块归入该图；新图号创建独立 Figure。其他图块、Panel 与原文保持。图号为空也可创建。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button disabled={busy} onClick={cancel}>
                取消
              </Button>
              <Button primary disabled={busy || (!title.regionId && !title.bbox)} onClick={() => void saveTitle()}>
                保存图块
              </Button>
            </div>
          </div>
        </ProjectDialog>
      )}
      {moveConfirm?.kind === 'move-region' && moveConfirm.destination.kind === 'existing' && title && (
        <ProjectDialog title="确认图块归入已有 Figure" busy={busy} onClose={() => setMoveConfirm(undefined)}>
          <p className="text-sm leading-relaxed">
            {regionIn(paper, moveConfirm.regionId).figure.label || '未标号 Figure'} · 第 {title.pageNumber}{' '}
            页的当前图块，将归入{' '}
            {paper.figures.find(
              (figure) => moveConfirm.destination.kind === 'existing' && figure.id === moveConfirm.destination.figureId,
            )?.label || '未标号 Figure'}
            。只移动当前图块，保留全部 Panel 与边框；整体核对确认失效，旧稿仍绑定原底稿。
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Button onClick={() => setMoveConfirm(undefined)}>返回编辑</Button>
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void commit(moveConfirm).then((saved) => {
                  if (saved) setMoveConfirm(undefined);
                })
              }
            >
              确认归入
            </Button>
          </div>
        </ProjectDialog>
      )}
    </>
  );
}
