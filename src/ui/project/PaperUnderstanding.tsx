import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '../controls';
import { StoryTopics, type Paper, type Claim } from '../../modules/paper/paper.schema';
import { researchPrompt } from '../../shared/llm/prompts';
import type { FigureImage } from '../editor/SlidePreview';

const topicLabels = {
  background: '研究背景',
  knowledgeGap: '知识空白',
  question: '研究问题',
  studyDesign: '研究设计',
  mainFindings: '主要发现',
  novelty: '创新点',
  limitations: '局限',
  conclusion: '总结',
};
const strengthLabels = {
  descriptive: '描述性证据',
  associative: '关联性证据',
  supportive: '支持性证据',
  causal: '因果性证据',
};

export function PaperUnderstanding({
  paper,
  strategyId,
  onSource,
  image,
  sourceAvailable,
}: {
  paper: Paper;
  strategyId?: string;
  onSource: (sourceId: string) => void;
  image: FigureImage;
  sourceAvailable: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const { strategy, fallback } = researchPrompt(strategyId);
  const claims = expanded ? paper.claims : paper.claims.slice(0, 6);
  function sources(ids: string[]) {
    return <SourceLinks paper={paper} ids={ids} available={sourceAvailable} onSource={onSource} />;
  }
  return (
    <section aria-label="论文理解" className="mt-8 space-y-6">
      <header className="space-y-2 border-b border-line pb-4">
        <h2 className="text-lg font-semibold break-words">{paper.metadata.title || '论文标题未识别'}</h2>
        <p className="text-sm text-muted break-words">
          {[paper.metadata.authors?.join('、'), paper.metadata.journal, paper.metadata.year, paper.metadata.doi]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="text-sm">
          {paper.studyProfile?.type || '研究类型未确认'} · 叙事策略：{strategy.name}
        </p>
        {fallback && <p className="text-sm text-amber-700">原叙事策略不可用，后续生成将使用通用策略。</p>}
        {!sourceAvailable && <p className="text-sm text-amber-700">原 PDF 缺失，仍可阅读已保存的摘要和证据。</p>}
        {!paper.figures.length && <p className="text-sm text-amber-700">未识别到 Figure/Panel 图源。</p>}
      </header>
      {StoryTopics.map((topic) => (
        <section key={topic} className="space-y-2">
          <h3 className="text-sm font-semibold">{topicLabels[topic]}</h3>
          {topic === 'studyDesign' && paper.studyProfile && (
            <div className="space-y-2 text-sm">
              <p>{paper.studyProfile.designSummary}</p>
              {sources(paper.studyProfile.sourceIds)}
            </div>
          )}
          {!paper.story?.[topic].length && !(topic === 'studyDesign' && paper.studyProfile) && (
            <p className="text-sm text-muted">未提取到可确认的内容</p>
          )}
          {paper.story?.[topic].map((point) => (
            <div key={`${topic}-${point.text}`} className="space-y-2 text-sm">
              <p className="break-words">{point.text}</p>
              {point.claimIds.map((id) => {
                const claim = paper.claims.find((item) => item.id === id);
                return (
                  <p key={id} className="text-muted">
                    依据：{claim?.text || '结论引用缺失'}
                  </p>
                );
              })}
              {sources(point.sourceIds)}
            </div>
          ))}
        </section>
      ))}
      <section className="border-t border-line pt-5" aria-label="结论与证据">
        <h3 className="text-base font-semibold">结论与证据（{paper.claims.length}）</h3>
        {!claims.length && <p className="mt-3 text-sm text-muted">未提取到可确认的结论</p>}
        {claims.map((claim, index) => (
          <ClaimEvidence
            key={claim.id}
            claim={claim}
            index={index}
            paper={paper}
            image={image}
            sourceAvailable={sourceAvailable}
            onSource={onSource}
          />
        ))}
        {paper.claims.length > 6 && (
          <Button onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起其余结论' : `展开其余 ${paper.claims.length - 6} 项结论`}
          </Button>
        )}
      </section>
    </section>
  );
}

function SourceLinks({
  paper,
  ids,
  available,
  onSource,
}: {
  paper: Paper;
  ids: string[];
  available: boolean;
  onSource: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {[...new Set(ids)].map((id) => {
        const source = paper.sources.find((item) => item.id === id);
        return source ? (
          <Button key={id} disabled={!available} onClick={() => onSource(id)}>
            <FileText size={14} />
            原文第 {source.pageNumber} 页
          </Button>
        ) : (
          <span key={id} className="text-sm text-amber-700">
            来源缺失
          </span>
        );
      })}
    </div>
  );
}

function ClaimEvidence({
  claim,
  index,
  paper,
  image,
  sourceAvailable,
  onSource,
}: {
  claim: Claim;
  index: number;
  paper: Paper;
  image: FigureImage;
  sourceAvailable: boolean;
  onSource: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="my-4 border-b border-line pb-4 text-sm" aria-label={`结论 ${index + 1}`}>
      <h4 className="font-medium break-words">
        {index + 1}. {claim.text}
      </h4>
      <p className="mt-1 text-xs text-muted">{strengthLabels[claim.strength]}</p>
      {!claim.evidenceIds.length && <p className="mt-2 text-amber-700">尚无关联证据，需要核对</p>}
      {claim.evidenceIds.length > 0 && (
        <img
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='%23f3f4f6'/%3E%3C/svg%3E"
          alt="论文证据图"
          className="mt-3 aspect-[4/3] w-full object-contain sm:w-1/2"
        />
      )}
      <details className="mt-3" onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer">查看证据（{claim.evidenceIds.length}）</summary>
        {claim.evidenceIds.map((id) => {
          const evidence = paper.evidences.find((item) => item.id === id);
          if (!evidence)
            return (
              <p key={id} className="mt-3 text-amber-700">
                证据引用缺失
              </p>
            );
          const figures = paper.figures.flatMap((figure) => [
            ...(evidence.sourceIds.includes(figure.sourceId)
              ? [{ id: figure.id, figureId: figure.id, label: figure.label || 'Figure', sourceId: figure.sourceId }]
              : []),
            ...figure.panels
              .filter((panel) => evidence.sourceIds.includes(panel.sourceId))
              .map((panel) => ({
                id: panel.id,
                figureId: figure.id,
                panelId: panel.id,
                label: `${figure.label || 'Figure'} ${panel.label || 'Panel'}`,
                sourceId: panel.sourceId,
              })),
          ]);
          if (!figures.length && evidence.sourceIds[0])
            figures.push({ id: evidence.sourceIds[0], figureId: evidence.sourceIds[0], label: '证据图', sourceId: evidence.sourceIds[0] });
          return (
            <div key={id} className="mt-4 space-y-3">
              <p className="break-words">{evidence.summary}</p>
              <SourceLinks paper={paper} ids={evidence.sourceIds} available={sourceAvailable} onSource={onSource} />
              {evidence.sourceIds.map((sourceId) => {
                const quote = paper.sources.find((source) => source.id === sourceId)?.textQuote;
                return quote ? (
                  <blockquote key={sourceId} className="border-l-2 border-line pl-3 text-muted break-words">
                    {quote}
                  </blockquote>
                ) : null;
              })}
              <div className="grid gap-4 sm:grid-cols-2">
                {figures.map((figure) => (
                  <figure key={figure.id} className="min-w-0">
                    {expanded && <EvidenceImage figure={figure} image={image} />}
                    <figcaption className="mt-2">
                      <Button disabled={!sourceAvailable} onClick={() => onSource(figure.sourceId)}>
                        <FileText size={14} />
                        {figure.label}
                      </Button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          );
        })}
      </details>
    </article>
  );
}

function EvidenceImage({
  figure,
  image,
}: {
  figure: { id: string; figureId: string; panelId?: string };
  image: FigureImage;
}) {
  const placeholder =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="3"%3E%3Crect width="4" height="3" fill="%23f3f4f6"/%3E%3C/svg%3E';
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({ url: placeholder });
  useEffect(() => {
    let active = true;
    setState({ url: placeholder });
    void image({ id: figure.id, type: 'figure', figureId: figure.figureId, panelId: figure.panelId }).then(
      (url) => {
        if (active) setState({ url });
      },
      () => {
        if (active) setState({ failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [figure.id, figure.figureId, figure.panelId, image]);
  return (
    <div className="flex aspect-[4/3] items-center justify-center bg-white">
      {state.url ? (
        <img src={state.url} alt="论文证据图" className="h-full w-full object-contain" />
      ) : (
        <span className="text-xs text-muted">{state.failed ? '图源暂不可用，请查看原文' : '正在加载图源…'}</span>
      )}
    </div>
  );
}
