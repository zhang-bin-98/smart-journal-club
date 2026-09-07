import { Crop, FileText, PanelRightClose, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Element, LayoutId, Slide } from '../../modules/deck/deck.schema';
import { LayoutIds } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import { figureSource, sourceText } from '../../modules/paper/sources';
import { Button, IconButton, inputClass } from '../controls';
import type { Editing } from './SlidePreview';

export type InspectorTab = 'content' | 'source' | 'layout' | 'ai';
const tabs: [InspectorTab, string][] = [
  ['content', '内容'],
  ['source', '图源'],
  ['layout', '版式'],
  ['ai', 'AI'],
];
const layoutNames: Record<LayoutId, string> = {
  title: '标题',
  'text-only': '文字',
  'figure-full': '单图',
  'figure-text': '图文',
  'two-figures': '双图',
  'panel-grid': 'Panel 网格',
};

export function Inspector({
  slide,
  element,
  paper,
  tab,
  onTab,
  onCollapse,
  onSource,
  onCrop,
  onDeleteElement,
  onLayout,
  editing,
  resourceAvailable,
  readOnly,
  ai,
}: {
  slide?: Slide;
  element?: Element;
  paper: Paper;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onCollapse: () => void;
  onSource: (sourceId: string) => void;
  onCrop: (sourceId: string) => void;
  onDeleteElement: () => void;
  onLayout: (layoutId: LayoutId) => void;
  editing?: Editing;
  resourceAvailable: boolean;
  readOnly: boolean;
  ai?: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Inspector">
      <div className="flex items-center gap-1 border-b border-line bg-white p-2">
        <div role="tablist" aria-label="Inspector 标签" className="flex min-w-0 flex-1 gap-1">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              disabled={value === 'ai' && !ai}
              className="min-h-8 rounded px-2 text-xs text-muted aria-selected:bg-accent/10 aria-selected:font-medium aria-selected:text-accent disabled:opacity-40"
              onClick={() => onTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton label="收起 Inspector" onClick={onCollapse}>
          <PanelRightClose size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-panel p-4">
        {!slide ? (
          <p className="text-xs text-muted">还没有可检查的页面。</p>
        ) : tab === 'content' ? (
          <ContentInspector slide={slide} element={element} paper={paper} editing={editing} />
        ) : tab === 'source' ? (
          <SourceInspector
            slide={slide}
            element={element}
            paper={paper}
            resourceAvailable={resourceAvailable}
            readOnly={readOnly}
            onSource={onSource}
            onCrop={onCrop}
            onDeleteElement={onDeleteElement}
          />
        ) : tab === 'layout' ? (
          <LayoutInspector slide={slide} element={element} readOnly={readOnly} onLayout={onLayout} />
        ) : (
          ai
        )}
      </div>
    </section>
  );
}

function ContentInspector({
  slide,
  element,
  paper,
  editing,
}: {
  slide: Slide;
  element?: Element;
  paper: Paper;
  editing?: Editing;
}) {
  return (
    <div className="space-y-4 text-xs">
      <InspectorField label="本页目的" editKey="purpose" value={slide.purpose ?? ''} editing={editing} />
      <InspectorField label="本页结论" editKey="message" value={slide.message ?? ''} editing={editing} />
      <Info label="页面类型">{slide.kind}</Info>
      <Info label="Claim">
        {slide.claimIds.length
          ? slide.claimIds
              .map((id) => paper.claims.find((claim) => claim.id === id)?.text ?? `未知 Claim：${id}`)
              .join('\n')
          : '未关联 Claim'}
      </Info>
      <Info label="来源">{sourceText(paper, slide.sourceIds) || '未关联来源'}</Info>
      {element && <Info label="选中元素">{elementLabel(element, paper)}</Info>}
    </div>
  );
}

function InspectorField({
  label,
  editKey,
  value,
  editing,
}: {
  label: string;
  editKey: string;
  value: string;
  editing?: Editing;
}) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => {
    if (!editing?.hasDraft(editKey)) setDraft(value);
  }, [value, editing, editKey]);
  const update = (next: string) => {
    setDraft(next);
    editing?.onDraft({
      key: editKey,
      value: next,
      original: value,
      composing: composing.current,
      save: () => editing.onSave(editKey, next),
    });
  };
  return (
    <label className="block">
      <span className="mb-1 block font-medium">{label}</span>
      <textarea
        aria-label={label}
        className={`${inputClass} min-h-20 resize-y text-xs`}
        placeholder={`${label}未填写`}
        value={draft}
        readOnly={!editing}
        onChange={(event) => update(event.target.value)}
        onBlur={() => {
          if (!composing.current) editing?.onBlur();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          update(event.currentTarget.value);
          if (document.activeElement !== event.currentTarget) editing?.onBlur();
        }}
      />
    </label>
  );
}

function SourceInspector({
  slide,
  element,
  paper,
  resourceAvailable,
  readOnly,
  onSource,
  onCrop,
  onDeleteElement,
}: {
  slide: Slide;
  element?: Element;
  paper: Paper;
  resourceAvailable: boolean;
  readOnly: boolean;
  onSource: (sourceId: string) => void;
  onCrop: (sourceId: string) => void;
  onDeleteElement: () => void;
}) {
  let selectedSource: ReturnType<typeof figureSource> | undefined;
  if (element?.type === 'figure') {
    try {
      selectedSource = figureSource(paper, element);
    } catch {
      // 历史项目可能包含失效引用；检查页仍需可打开并定位该问题。
    }
  }
  const sourceIds = [...new Set([...(selectedSource ? [selectedSource.id] : []), ...slide.sourceIds])];
  return (
    <div className="space-y-4 text-xs">
      <Info label="选中元素">{element ? elementLabel(element, paper) : '未选中元素，显示本页来源'}</Info>
      {element?.type === 'figure' && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!resourceAvailable || !selectedSource}
            onClick={() => selectedSource && onSource(selectedSource.id)}
          >
            <FileText size={14} />
            查看来源
          </Button>
          <Button
            disabled={!resourceAvailable || readOnly || !selectedSource}
            onClick={() => selectedSource && onCrop(selectedSource.id)}
          >
            <Crop size={14} />
            调整裁图
          </Button>
          <Button disabled={readOnly} onClick={onDeleteElement}>
            <Trash2 size={14} />
            删除元素
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {sourceIds.map((id) => {
          const source = paper.sources.find((item) => item.id === id);
          return (
            <Button
              key={id}
              disabled={!resourceAvailable}
              className="w-full justify-start"
              onClick={() => onSource(id)}
            >
              <FileText size={14} />
              {source ? `论文第 ${source.pageNumber} 页 · ${source.kind}` : `未知来源：${id}`}
            </Button>
          );
        })}
        {!sourceIds.length && <p className="text-muted">本页没有可定位来源。</p>}
      </div>
    </div>
  );
}

function LayoutInspector({
  slide,
  element,
  readOnly,
  onLayout,
}: {
  slide: Slide;
  element?: Element;
  readOnly: boolean;
  onLayout: (layoutId: LayoutId) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <label className="block">
        <span className="mb-1 block font-medium">页面布局</span>
        <select
          aria-label="选择布局"
          value={slide.layoutId}
          disabled={readOnly}
          className={inputClass}
          onChange={(event) => onLayout(event.target.value as LayoutId)}
        >
          {LayoutIds.map((id) => (
            <option key={id} value={id}>
              {layoutNames[id]}
            </option>
          ))}
        </select>
      </label>
      <Info label="当前结构">
        {slide.elements.length} 个元素；{slide.layoutId}
      </Info>
      <Info label="选中元素">{element ? element.type : '未选中'}</Info>
      <p className="leading-relaxed text-muted">布局只使用既有六类模板，不提供自由坐标。图像保持等比显示。</p>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-muted">{children}</p>
    </div>
  );
}

function elementLabel(element: Element, paper: Paper) {
  if (element.type === 'figure') {
    const figure = paper.figures.find((item) => item.id === element.figureId);
    const panel = element.panelId ? figure?.panels.find((item) => item.id === element.panelId) : undefined;
    return `${figure?.label ?? element.figureId}${panel?.label ? ` ${panel.label}` : ''}${element.cropOverride ? ' · 已调整裁图' : ''}`;
  }
  if (element.type === 'text') return `文字 · ${element.text || '空'}`;
  if (element.type === 'bullet-list') return `列表 · ${element.items.length} 项`;
  return `引用 · ${sourceText(paper, element.sourceIds) || '来源缺失'}`;
}
