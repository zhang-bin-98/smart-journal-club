import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/paper.schema';

export function FinalOutline({ deck, paper }: { deck: Deck; paper: Paper }) {
  return (
    <section aria-label="当前文稿最终大纲" className="space-y-5">
      <h2 className="text-lg font-semibold break-words">{deck.title}</h2>
      <p className="text-sm text-muted">当前文稿 · 只读大纲 · {deck.slides.length} 页</p>
      {!deck.slides.length && <p className="text-sm text-muted">当前文稿没有页面</p>}
      {deck.sections.map((section) => (
        <section key={section.id} className="border-t border-line pt-4">
          <h3 className="text-base font-semibold break-words">{section.title}</h3>
          <p className="mt-2 text-sm">{section.purpose || '章节目的未填写'}</p>
          {deck.slides
            .filter((slide) => slide.sectionId === section.id)
            .map((slide) => (
              <article key={slide.id} className="mt-4 space-y-2 border-l-2 border-line pl-4 text-sm">
                <h4 className="font-medium break-words">
                  {deck.slides.indexOf(slide) + 1}. {slide.title}
                </h4>
                <p>页面目的：{slide.purpose || '未填写'}</p>
                <p>本页结论：{slide.message || '未填写'}</p>
                {slide.claimIds.map((id) => (
                  <p key={id} className="text-muted">
                    {paper.claims.find((claim) => claim.id === id)?.text || '结论引用缺失'}
                  </p>
                ))}
                {slide.elements
                  .filter((element) => element.type === 'figure')
                  .map((element) => {
                    const figure = paper.figures.find((item) => item.id === element.figureId);
                    const panel = figure?.panels.find((item) => item.id === element.panelId);
                    return (
                      <p key={element.id} className="text-muted">
                        {figure?.label || 'Figure'} {element.panelId ? panel?.label || 'Panel' : ''}
                      </p>
                    );
                  })}
              </article>
            ))}
          {section.transitionToNext && <p className="mt-3 text-sm text-muted">{section.transitionToNext}</p>}
        </section>
      ))}
    </section>
  );
}
