import { paragraphSources, type Content } from '../../modules/presentation/content';
import type { SpeechController } from './useSpeechController';
import { CropPreview } from '../paper/BoxEditor';
import { Button } from '../controls';
import { useEffect, useState } from 'react';
import { SpeechSourceCard } from './SpeechSourceCard';
export function SpeechEvidence({
  controller: c,
  selectedId,
  onSelect,
}: {
  controller: SpeechController;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [sourceId, setSourceId] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: 跟随新选中的讲述恢复其证据上下文。
  useEffect(() => setSourceId(undefined), [selectedId]);
  const data = c.state.data!;
  const content = data.target?.content;
  const paper = data.paper;
  const ids = content && selectedId ? paragraphSources(content, selectedId) : [];
  const options = paper.figures.flatMap((f) =>
    f.regions.flatMap((r) => [
      { id: r.sourceId, label: (f.label ?? 'Figure') + ' · 整图' },
      ...r.panels.map((p) => ({ id: p.sourceId, label: (f.label ?? 'Figure') + ' · ' + (p.label ?? 'Panel') })),
    ]),
  );
  const source = paper.sources.find((s) => s.id === sourceId);
  const selectedSources = paper.sources.filter((s) => ids.includes(s.id));
  const claims = paper.claims.filter((claim) =>
    content?.speech.some((s) => s.paragraphId === selectedId && s.claimIds.includes(claim.id)),
  );
  const usedBy = (value: Content, id: string) =>
    value.speechParagraphs.filter((p) => value.speech.some((s) => s.paragraphId === p.id && s.sourceIds.includes(id)));
  return (
    <div className="space-y-4 p-4">
      <h2 className="font-semibold">对应证据</h2>
      {source && (
        <div className="space-y-2 rounded border border-line p-2">
          <p className="text-xs">
            {paper.documents.find((d) => d.id === source.documentId)?.fileName} · 第 {source.pageNumber} 页
          </p>
          {source.bbox && c.resources && (
            <CropPreview
              resources={c.resources}
              documentId={source.documentId}
              pageNumber={source.pageNumber}
              bbox={{ x: 0, y: 0, width: 1, height: 1 }}
            />
          )}
          <p className="whitespace-pre-wrap text-xs leading-relaxed">
            {source.textQuote ||
              (source.textSpan &&
                paper.blocks
                  .find((b) => b.id === source.textSpan?.blockId)
                  ?.text.slice(source.textSpan.start, source.textSpan.end))}
          </p>
          <Button onClick={() => setSourceId(undefined)}>返回证据列表</Button>
        </div>
      )}
      {!selectedId && <p className="text-muted">选择讲述后查看和调整证据。</p>}
      {selectedId && (
        <>
          {selectedSources
            .filter((s) => s.bbox)
            .map((s) => (
              <SpeechSourceCard key={s.id} paper={paper} id={s.id} resources={c.resources} onSource={setSourceId} />
            ))}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium">多选图证据</legend>
            {options.map((option) => (
              <div key={option.id} className="rounded border border-line p-2 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ids.includes(option.id)}
                    disabled={c.running || c.state.saving || data.stale}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      void c.act(() =>
                        c.session.commit([
                          {
                            type: 'update-paragraph',
                            paragraphId: selectedId,
                            sourceIds: checked ? [...ids, option.id] : ids.filter((id) => id !== option.id),
                          },
                        ]),
                      );
                    }}
                  />
                  {option.label}
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="text-accent" onClick={() => setSourceId(option.id)}>
                    查看来源
                  </button>
                  {content &&
                    usedBy(content, option.id).map((p) => (
                      <button key={p.id} className="text-muted underline" onClick={() => onSelect(p.id)}>
                        用于：{p.purpose || '讲述'}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </fieldset>
          <section>
            <h3 className="mb-2 text-xs font-medium">已选证据的原句与图注</h3>
            {selectedSources.map((s) => (
              <div key={s.id} className="mb-3 text-xs leading-relaxed">
                <button className="text-accent" onClick={() => setSourceId(s.id)}>
                  {paper.documents.find((d) => d.id === s.documentId)?.role === 'primary' ? '主论文' : '补充材料'} · 第{' '}
                  {s.pageNumber} 页
                </button>
                <p>
                  {s.textQuote ||
                    (s.textSpan &&
                      paper.blocks
                        .find((b) => b.id === s.textSpan?.blockId)
                        ?.text.slice(s.textSpan.start, s.textSpan.end)) ||
                    '图像来源，点击查看原图。'}
                </p>
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-medium">本段发现</h3>
            {claims.map((claim) => (
              <p key={claim.id} className="mb-2 text-xs leading-relaxed">
                {claim.text}
              </p>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
