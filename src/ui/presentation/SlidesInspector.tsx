import { useState } from 'react';
import { GroupPreview } from './GroupPreview';
import type { FigureResources } from '../../app/paper/figureResources';
import type { Deck, DeckMutation, Slide, Element } from '../../modules/presentation/editing/schema';
import type { Paper } from '../../modules/paper/model';
import {
  groupPreset,
  rankGroups,
  type FigureGroup,
  type FigureGroupNode,
  type GroupPreset,
} from '../../modules/presentation/layout';
import { imageAspect, figureArea } from '../../modules/presentation/layout/figureGeometry';
import { setFigures, assignSpeech } from '../../modules/presentation/editing';
import { figureSource } from '../../modules/paper/sources';
import { Button, inputClass } from '../controls';
const names: Record<string, string> = {
  title: '标题',
  'text-only': '文字',
  'figure-full': '整图',
  'figure-text': '图文',
  'two-figures': '双图',
  'panel-grid': 'Panel 网格',
};
function Partition({
  node,
  onChange,
  path = '根分区',
  onSave,
}: {
  node: FigureGroupNode;
  onChange: (node: FigureGroupNode) => void;
  path?: string;
  onSave: () => void;
}) {
  if (node.kind === 'image') return null;
  return (
    <div className="space-y-2 border-l border-line pl-2">
      <label className="block text-xs">
        {path} · {node.direction === 'row' ? '左侧' : '上方'}比例
        <input
          aria-label={`${path}比例`}
          type="range"
          min="0.1"
          max="0.9"
          step="0.01"
          value={node.ratio}
          onChange={(e) => onChange({ ...node, ratio: Number(e.target.value) })}
          onPointerUp={onSave}
          onKeyUp={onSave}
          className="w-full"
        />
        <input
          aria-label={`${path}比例数值`}
          className={inputClass}
          type="number"
          min="0.1"
          max="0.9"
          step="0.01"
          value={node.ratio}
          onChange={(e) => onChange({ ...node, ratio: Number(e.target.value) })}
          onBlur={onSave}
        />
      </label>
      <Partition
        node={node.first}
        path={`${path}一`}
        onChange={(first) => onChange({ ...node, first })}
        onSave={onSave}
      />
      <Partition
        node={node.second}
        path={`${path}二`}
        onChange={(second) => onChange({ ...node, second })}
        onSave={onSave}
      />
    </div>
  );
}
export function SlidesInspector({
  deck,
  slide,
  paper,
  resources,
  tab,
  commit,
  onSource,
  changeGroup,
  saveGroup,
  onSpeech,
}: {
  deck: Deck;
  slide?: Slide;
  paper: Paper;
  resources?: FigureResources;
  tab: string;
  commit: (mutations: DeckMutation[], summary: string) => void;
  onSource: (id: string, element?: Extract<Element, { type: 'figure' }>, crop?: boolean) => void;
  changeGroup: (group: FigureGroup) => void;
  saveGroup: () => void;
  onSpeech: () => void;
}) {
  const [candidate, setCandidate] = useState<{ revision: number; slideId: string; group: FigureGroup }>();
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState('');
  const figures = slide?.elements.filter((e) => e.type === 'figure') ?? [];
  const assigned = new Set(deck.slides.flatMap((s) => s.speechIds ?? []));
  const unassigned = deck.speech?.filter((s) => !assigned.has(s.id)) ?? [];
  if (!slide) return <p className="p-4 text-muted">还没有幻灯片，可新增页或撤销删除。</p>;
  const group = slide.figureGroup;
  const applyGroup = (next: FigureGroup) =>
    commit([{ type: 'update-slide', slideId: slide.id, changes: { figureGroup: next } }], '调整本页图组');
  if (tab === 'speech')
    return (
      <div className="space-y-4 p-4">
        <Button onClick={onSpeech}>到大纲编辑对应段落</Button>
        <p className="text-xs text-muted">只移动页面分配，保留段落章节与唯一正文。</p>
        <select
          aria-label="讲稿移入页面"
          className={inputClass}
          value={target || slide.id}
          onChange={(e) => setTarget(e.target.value)}
        >
          {deck.slides.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1} · {s.title}
            </option>
          ))}
        </select>
        {(slide.speechIds ?? [])
          .flatMap((id) => deck.speech?.find((s) => s.id === id) ?? [])
          .map((s) => (
            <div key={s.id} className="space-y-2 border-b border-line pb-3">
              <p className="text-xs leading-relaxed">{s.text}</p>
              <Button
                disabled={(target || slide.id) === slide.id}
                onClick={() => commit(assignSpeech(deck, [s.id], target || slide.id), '移动讲述')}
              >
                移入目标页
              </Button>
            </div>
          ))}
        <h3 className="font-medium">待安排讲稿 · {unassigned.length}</h3>
        {unassigned.map((s) => (
          <div key={s.id} className="space-y-2 rounded border border-line p-2">
            <p className="text-xs">{s.text}</p>
            <Button onClick={() => commit(assignSpeech(deck, [s.id], target || slide.id), '安排讲稿')}>
              安排到目标页
            </Button>
          </div>
        ))}
      </div>
    );
  if (tab === 'layout')
    return (
      <div className="space-y-4 p-4">
        <h3 className="font-medium">页面版式</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(names).map(([id, name]) => (
            <Button
              key={id}
              aria-pressed={slide.layoutId === id}
              onClick={() =>
                commit(
                  [{ type: 'update-slide', slideId: slide.id, changes: { layoutId: id as Slide['layoutId'] } }],
                  '更换版式',
                )
              }
            >
              {name}
            </Button>
          ))}
        </div>
        {!!figures.length && (
          <>
            <h3 className="font-medium">图组分区</h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['row', '横排'],
                  ['column', '竖排'],
                  ['grid', '网格'],
                  ['left-pair', '左二右一'],
                  ['top-pair', '上二下一'],
                ] as [GroupPreset, string][]
              ).map(([preset, name]) => (
                <Button
                  key={preset}
                  onClick={() =>
                    setCandidate({
                      revision: deck.revision,
                      slideId: slide.id,
                      group: groupPreset(
                        figures.map((f) => f.id),
                        preset,
                      ),
                    })
                  }
                >
                  {name}
                </Button>
              ))}
            </div>
            <Button
              onClick={() =>
                setCandidate({
                  revision: deck.revision,
                  slideId: slide.id,
                  group: rankGroups(
                    figures.map((f) => ({ id: f.id, aspect: imageAspect(paper, f) })),
                    figureArea(slide),
                  )[0].group,
                })
              }
            >
              建议重新排列
            </Button>
            {candidate && candidate.slideId === slide.id && (
              <div className="space-y-2 rounded border border-accent p-3">
                <p className="text-xs">当前排列</p>
                <GroupPreview slide={slide} paper={paper} resources={resources} />
                <p className="text-xs">分区候选 · 图像来源与顺序保留</p>
                <GroupPreview slide={{ ...slide, figureGroup: candidate.group }} paper={paper} resources={resources} />
                <p className="text-xs">
                  {candidate.group.root.kind === 'split'
                    ? (candidate.group.root.direction === 'row' ? '左右分区' : '上下分区') +
                      ' · 首区 ' +
                      Math.round(candidate.group.root.ratio * 100) +
                      '%'
                    : '单图'}
                </p>
                <Button
                  disabled={candidate.revision !== deck.revision}
                  onClick={() => {
                    applyGroup(candidate.group);
                    setCandidate(undefined);
                  }}
                >
                  应用排列
                </Button>
                <Button onClick={() => setCandidate(undefined)}>放弃</Button>
                {candidate.revision !== deck.revision && <p>页面已变化，请重新请求。</p>}
              </div>
            )}
            {group && (
              <>
                <GroupPreview slide={slide} paper={paper} resources={resources} change={changeGroup} save={saveGroup} />
                <p className="text-xs text-muted">拖动分隔线，或聚焦后用方向键微调；松开一次保存。</p>
                <Partition node={group.root} onChange={(root) => changeGroup({ ...group, root })} onSave={saveGroup} />
                <label className="block text-xs">
                  图间距（pt）
                  <input
                    aria-label="图间距"
                    type="number"
                    min="0"
                    max="36"
                    className={inputClass}
                    value={group.gapPt}
                    onChange={(e) => changeGroup({ ...group, gapPt: Number(e.target.value) })}
                    onBlur={saveGroup}
                  />
                </label>
              </>
            )}
          </>
        )}
      </div>
    );
  if (tab === 'source')
    return (
      <div className="space-y-3 p-4">
        <h3 className="font-medium">本页图源 · {figures.length}/4</h3>
        {figures.map((figure, index) => (
          <div key={figure.id} className="space-y-2 rounded border border-line p-3">
            <p className="text-xs">
              {paper.figures.find((f) => f.id === figure.figureId)?.label}{' '}
              {paper.figures.flatMap((f) => f.regions.flatMap((r) => r.panels)).find((p) => p.id === figure.panelId)
                ?.label ?? '整图'}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button onClick={() => onSource(figureSource(paper, figure).id, figure)}>来源</Button>
              <Button onClick={() => onSource(figureSource(paper, figure).id, figure, true)}>本页裁图</Button>
              <Button
                onClick={() =>
                  commit([{ type: 'delete-element', slideId: slide.id, elementId: figure.id }], '删除图像')
                }
              >
                删除
              </Button>
              <Button
                disabled={!index}
                onClick={() => {
                  const ids = figures.map((f) => figureSource(paper, f).id);
                  [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                  commit(setFigures(slide, paper, ids), '调整图像顺序');
                }}
              >
                上移
              </Button>
            </div>
          </div>
        ))}
        <Button
          onClick={() => {
            setPicking(!picking);
            setPicked(figures.map((f) => figureSource(paper, f).id));
          }}
        >
          选择 / 更换图源
        </Button>
        {picking && (
          <div className="space-y-2">
            <p className="text-xs text-muted">选择最多四张图；只更改本页。</p>
            {paper.figures.map((f) => (
              <fieldset key={f.id} className="space-y-1 border-b border-line py-2">
                <legend>{f.label}</legend>
                {f.regions
                  .flatMap((r) => [
                    { id: r.sourceId, label: '整图块' },
                    ...r.panels.map((p) => ({ id: p.sourceId, label: p.label ?? 'Panel' })),
                  ])
                  .map((source) => (
                    <label key={source.id} className="flex gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={picked.includes(source.id)}
                        onChange={(e) =>
                          setPicked(e.target.checked ? [...picked, source.id] : picked.filter((id) => id !== source.id))
                        }
                      />
                      {source.label}
                    </label>
                  ))}
              </fieldset>
            ))}
            <Button
              disabled={picked.length > 4}
              onClick={() => {
                commit(setFigures(slide, paper, picked), '更换本页图源');
                setPicking(false);
              }}
            >
              应用图源选择
            </Button>
          </div>
        )}
      </div>
    );
  return (
    <div className="space-y-4 p-4">
      <h3 className="font-medium">{slide.title || '未命名页'}</h3>
      <p className="text-xs text-muted">{slide.purpose}</p>
      <p className="text-xs">在画布点击标题或正文直接编辑。完整讲稿在下方，图像操作位于图源标签。</p>
      <label className="block text-xs">
        页面所属章节
        <select
          aria-label="页面所属章节"
          className={inputClass}
          value={slide.sectionId}
          onChange={(e) =>
            commit(
              [
                {
                  type: 'move-slide',
                  slideId: slide.id,
                  targetSectionId: e.target.value,
                  afterSlideId: deck.slides[deck.slides.indexOf(slide) - 1]?.id ?? null,
                },
              ],
              '调整页面章节',
            )
          }
        >
          {deck.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.track === 'supplement' ? '补充 · ' : ''}
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <Button
        onClick={() =>
          commit(
            [{ type: 'add-element', slideId: slide.id, element: { id: crypto.randomUUID(), type: 'text', text: '' } }],
            '新增文字',
          )
        }
      >
        新增文字
      </Button>
    </div>
  );
}
