import './style.css';
import { fixtureDeck, fixturePaper, fixtureSource } from './fixtures';
import { computeLayout, validateDeck } from './layout';
import { createSlide, DeckSession } from './deck';
import { exportDeck } from './export';
import type { Element, Slide } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const placeholder = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#e8eef2"/><text x="300" y="250" font-size="40" fill="#39718c">Figure 3</text></svg>');
const session = new DeckSession(fixtureDeck, fixturePaper);
let selected = 0; let selectedElementId: string | null = null; let status = '已保存';
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const controlClasses = 'cursor-pointer rounded-[5px] border px-[11px] py-[7px] text-xs leading-normal whitespace-nowrap enabled:hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45';
const buttonVariants = {
  default: 'border-control bg-white text-ink',
  primary: 'border-accent bg-accent text-white',
  quiet: 'border-control bg-transparent text-muted',
};
const button = (id: string, label: string, variant: keyof typeof buttonVariants = 'default') =>
  `<button id="${id}" class="${controlClasses} ${buttonVariants[variant]}">${label}</button>`;
app.innerHTML = `
  <main class="mx-auto min-h-screen max-w-[1480px] p-3 font-sans text-ink sm:p-[18px] xl:px-7 xl:py-6">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-[18px]">
      <div class="flex items-center gap-2.5">
        <span class="grid size-[34px] shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-white">JC</span>
        <div><h1 class="text-xl leading-[1.2]">smartJC</h1><p class="text-xs text-muted">可编辑的文献汇报 Deck</p></div>
      </div>
      <div class="flex items-center gap-3">
        <span id="save-status" class="min-w-[52px] text-xs text-success"></span>
        ${button('export', '导出 PPTX', 'primary')}
        <button id="more" class="size-8 cursor-pointer rounded-[5px] border border-control bg-white text-lg leading-none text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" title="更多操作" aria-label="更多操作">⋯</button>
      </div>
    </header>
    <div class="mt-[18px] grid min-h-[680px] grid-cols-1 border border-line bg-white lg:grid-cols-[190px_minmax(0,1fr)_205px] xl:grid-cols-[218px_minmax(0,1fr)_238px]">
      <aside class="min-w-0 border-b border-line bg-panel p-[18px] lg:border-r lg:border-b-0">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">幻灯片</h2>${button('add-slide', '+ 新增页')}
        </div>
        <div id="slides" class="mt-[18px] grid gap-[7px]"></div>
        <div class="mt-[18px] text-xs leading-normal text-muted">拖动缩略图可调整顺序</div>
      </aside>
      <section class="min-w-0 px-3 pt-[18px] pb-4 sm:px-[22px]">
        <div class="flex items-end justify-between gap-3">
          <div class="min-w-0"><span class="mb-1 block text-xs text-muted">当前页面</span><h2 id="slide-heading" class="text-sm font-semibold wrap-anywhere"></h2></div>
          ${button('delete-slide', '删除本页', 'quiet')}
        </div>
        <div id="stage" class="mt-[18px] grid min-h-[220px] place-items-center border border-line bg-canvas p-2 sm:min-h-[440px] sm:p-[18px]"></div>
        <div class="flex min-h-[43px] flex-wrap items-center gap-3.5 border-b border-line pt-3.5 pb-2">
          <div class="flex items-center gap-[7px]">
            <span class="mr-0.5 text-xs text-muted">布局</span>
            <select id="layout-select" class="${controlClasses} ${buttonVariants.default}" aria-label="选择布局">
              <option value="title">标题</option><option value="text-only">文字</option><option value="figure-full">单图</option><option value="figure-text">图文</option><option value="two-figures">双图</option><option value="panel-grid">Panel 网格</option>
            </select>
          </div>
          <div id="selection-tools" class="flex flex-wrap items-center gap-[7px]"></div>
          <div class="ml-auto flex items-center gap-[7px]">${button('undo', '撤销')}${button('redo', '重做')}</div>
        </div>
        <div id="status" class="min-h-7 pt-2.5 text-xs text-muted" role="status"></div>
      </section>
      <aside class="min-w-0 border-t border-line bg-panel p-[18px] lg:border-t-0 lg:border-l">
        <div class="flex items-center justify-between gap-3">
          <div><span class="mb-1 block text-xs text-muted">编辑摘要</span><h2 class="text-sm font-semibold">当前 Deck</h2></div>
          <span class="text-xs whitespace-nowrap text-muted" id="revision"></span>
        </div>
        <div class="mt-[18px] border-t border-line pt-3">
          <strong class="block text-xs">${escapeHtml(fixtureDeck.title)}</strong>
          <p id="deck-summary" class="mt-[7px] text-[11px] leading-[1.55] text-muted"></p>
        </div>
        <div class="mt-[18px] border-t border-line pt-3">
          <span class="mb-1 block text-xs text-muted">来源</span>
          <strong class="block text-xs">PDF page ${fixtureSource.pageNumber}</strong>
          <p class="mt-[7px] text-[11px] leading-[1.55] wrap-anywhere text-muted">${fixtureSource.id} · Figure 3</p>
        </div>
      </aside>
    </div>
  </main>`;
const slidesEl = document.querySelector<HTMLDivElement>('#slides')!; const stageEl = document.querySelector<HTMLDivElement>('#stage')!; const heading = document.querySelector<HTMLHeadingElement>('#slide-heading')!; const statusEl = document.querySelector<HTMLDivElement>('#status')!; const saveEl = document.querySelector<HTMLSpanElement>('#save-status')!; const revisionEl = document.querySelector<HTMLSpanElement>('#revision')!; const selectionEl = document.querySelector<HTMLDivElement>('#selection-tools')!; const layoutSelect = document.querySelector<HTMLSelectElement>('#layout-select')!; const undoButton = document.querySelector<HTMLButtonElement>('#undo')!; const redoButton = document.querySelector<HTMLButtonElement>('#redo')!;
function currentSlide() { return session.current.slides[selected]; }
function position(rect: { x:number; y:number; width:number; height:number }) { return 'left:' + rect.x * 100 + '%;top:' + rect.y * 100 + '%;width:' + rect.width * 100 + '%;height:' + rect.height * 100 + '%'; }
function editable(content: string, kind: string, id = '') { return '<div class="min-h-[1em] flex-1 whitespace-pre-wrap wrap-anywhere outline-none focus:outline focus:outline-offset-[3px] focus:outline-focus" contenteditable="true" spellcheck="false" data-edit-kind="' + kind + '" data-element-id="' + id + '">' + escapeHtml(content) + '</div>'; }
function renderElement(element: Element, rect: { x:number; y:number; width:number; height:number }) {
  const selectedClass = element.id === selectedElementId ? ' outline-2 outline-offset-2 outline-accent' : '';
  const textClasses = 'overflow-hidden text-[2cqw] leading-[1.45] text-ink';
  if (element.type === 'figure') return '<button class="cursor-pointer overflow-hidden border border-control bg-panel p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus' + selectedClass + '" data-element-id="' + element.id + '" style="' + position(rect) + '" title="选择 Figure"><img class="block size-full object-contain" src="' + placeholder + '" alt="Figure 3" /></button>';
  if (element.type === 'citation') return '<div class="overflow-hidden text-[1.2cqw] leading-[1.45] text-muted' + selectedClass + '" data-element-id="' + element.id + '" style="' + position(rect) + '">' + editable(element.sourceIds.map(id => '来源：' + id).join('；'), 'citation', element.id) + '</div>';
  if (element.type === 'bullet-list') return '<div class="pl-1 ' + textClasses + selectedClass + '" data-element-id="' + element.id + '" style="' + position(rect) + '">' + element.items.map(item => '<div data-bullet-item class="flex gap-[3px]">• ' + editable(item, 'bullet', element.id) + '</div>').join('') + '</div>';
  return '<div class="' + textClasses + selectedClass + '" data-element-id="' + element.id + '" style="' + position(rect) + '">' + editable(element.text, 'text', element.id) + '</div>';
}
function renderDeck() {
  const slide = currentSlide(); selectedElementId = slide?.elements.some(element => element.id === selectedElementId) ? selectedElementId : null;
  slidesEl.innerHTML = session.current.slides.map((item, index) => '<button draggable="true" class="grid min-h-[51px] cursor-pointer grid-cols-[27px_minmax(0,1fr)] gap-x-[7px] gap-y-px rounded-[5px] border border-line bg-white px-2 py-[9px] text-left hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft" aria-current="' + (index === selected ? 'page' : 'false') + '" data-index="' + index + '"><span class="row-span-2 text-xs font-bold text-accent">' + String(index + 1).padStart(2, '0') + '</span><span class="truncate text-xs leading-[1.35]">' + escapeHtml(item.title || '无标题') + '</span><span class="text-[10px] text-subtle">' + item.kind + '</span></button>').join('');
  slidesEl.querySelectorAll<HTMLButtonElement>('[data-index]').forEach(item => { item.onclick = () => { selected = Number(item.dataset.index); selectedElementId = null; renderDeck(); }; item.ondragstart = event => { event.dataTransfer?.setData('text/plain', item.dataset.index || '0'); }; item.ondragover = event => event.preventDefault(); item.ondrop = event => { event.preventDefault(); const from = Number(event.dataTransfer?.getData('text/plain')); const to = Number(item.dataset.index); if (from !== to) { try { session.commit({ type: 'deck' }, [{ type: 'move-slide', slideId: session.current.slides[from].id, afterSlideId: to === 0 ? null : session.current.slides[to].id }], '调整页顺序'); selected = to; status = '已保存'; renderDeck(); } catch (error) { status = error instanceof Error ? error.message : String(error); renderDeck(); } } }; });
  revisionEl.textContent = 'revision ' + session.current.revision;
  saveEl.textContent = status;
  document.querySelector<HTMLParagraphElement>('#deck-summary')!.textContent = session.current.slides.length + ' 页 · ' + session.current.language;
  undoButton.disabled = !session.canUndo;
  redoButton.disabled = !session.canRedo;
  document.querySelector<HTMLButtonElement>('#delete-slide')!.disabled = !slide;
  document.querySelector<HTMLButtonElement>('#export')!.disabled = !session.current.slides.length;
  if (!slide) { heading.textContent = '暂无幻灯片'; stageEl.innerHTML = '<div class="text-[13px] text-muted">没有幻灯片，新增一页开始编辑。</div>'; selectionEl.innerHTML = ''; layoutSelect.disabled = true; statusEl.textContent = '空 Deck 可继续编辑，但导出已禁用。'; return; }
  layoutSelect.disabled = false; layoutSelect.value = slide.layoutId; heading.textContent = slide.title || '无标题'; const layout = computeLayout(slide);
  stageEl.innerHTML = '<div class="relative aspect-video w-full max-w-[760px] overflow-hidden border border-control bg-white shadow-[0_5px_16px_#18354412] [container-type:inline-size] [&>*]:absolute [&>*]:m-0"><div class="text-[3.2cqw] font-bold" style="' + position(layout.title) + '">' + editable(slide.title, 'title') + '</div>' + (layout.message ? '<div class="text-[1.6cqw] text-muted" style="' + position(layout.message) + '">' + editable(slide.message || '', 'message') + '</div>' : '') + layout.elements.map(item => renderElement(item.element, item.rect)).join('') + '<div class="overflow-hidden text-[1.1cqw] leading-none whitespace-nowrap text-muted" style="' + position(layout.sourceLabel) + '">来源：PDF page 1 · ' + fixtureSource.id + '</div></div>';
  selectionEl.innerHTML = '<span class="mr-0.5 text-xs text-muted">元素</span>' + button('add-text', '+ 文字') + button('add-list', '+ 列表') + button('add-citation', '+ 引用') + (selectedElementId ? button('delete-element', '删除选中', 'quiet') : '');
  statusEl.textContent = validateDeck(session.current, fixturePaper).length ? '当前 Deck 校验失败' : '修改会自动保存到当前会话';
  stageEl.querySelectorAll<HTMLElement>('[data-element-id]').forEach(node => node.onclick = event => { if ((event.target as HTMLElement).closest('[contenteditable]')) return; selectedElementId = node.dataset.elementId || null; renderDeck(); });
  stageEl.querySelectorAll<HTMLElement>('[data-edit-kind]').forEach(node => { node.dataset.original = node.textContent || ''; node.onblur = () => commitEdit(node); node.onkeydown = event => { if (event.key === 'Escape') { node.textContent = node.dataset.original || ''; node.blur(); } }; });
}
function commitEdit(node: HTMLElement) { const original = node.dataset.original || ''; const value = node.textContent || ''; if (value === original) return; const slide = currentSlide(); if (!slide) return; try { const kind = node.dataset.editKind; if (kind === 'title') session.commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { title: value } }], '编辑标题'); else if (kind === 'message') session.commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { message: value } }], '编辑副标题'); else { const element = slide.elements.find(item => item.id === node.dataset.elementId); if (!element) return; if (kind === 'text') session.commit({ type: 'element', slideId: slide.id, elementId: element.id }, [{ type: 'replace-element', slideId: slide.id, element: { ...element, type: 'text', text: value } }], '编辑文字'); else if (kind === 'bullet') { const items = Array.from(stageEl.querySelectorAll<HTMLElement>('[data-bullet-item]')).map(item => item.textContent?.replace(/^• /, '').trim() || ''); session.commit({ type: 'element', slideId: slide.id, elementId: element.id }, [{ type: 'replace-element', slideId: slide.id, element: { ...element, type: 'bullet-list', items } }], '编辑列表'); } else return; } status = '已保存'; renderDeck(); } catch (error) { status = error instanceof Error ? error.message : String(error); renderDeck(); } }
function commit(action: () => void) { try { action(); status = '已保存'; renderDeck(); } catch (error) { status = error instanceof Error ? error.message : String(error); renderDeck(); } }
document.querySelector<HTMLButtonElement>('#add-slide')!.onclick = () => commit(() => { const slide = createSlide('slide-' + crypto.randomUUID(), session.current.slides.length + 1); session.commit({ type: 'deck' }, [{ type: 'add-slide', slide, afterSlideId: session.current.slides.at(-1)?.id || null }], '新增幻灯片'); selected = session.current.slides.length - 1; });
document.querySelector<HTMLButtonElement>('#delete-slide')!.onclick = () => { const slide = currentSlide(); if (!slide) return; commit(() => { session.commit({ type: 'deck' }, [{ type: 'delete-slide', slideId: slide.id }], '删除幻灯片'); selected = Math.min(selected, Math.max(0, session.current.slides.length - 1)); selectedElementId = null; }); };
document.querySelector<HTMLButtonElement>('#undo')!.onclick = () => commit(() => { if (session.undo()) selected = Math.min(selected, Math.max(0, session.current.slides.length - 1)); selectedElementId = null; });
document.querySelector<HTMLButtonElement>('#redo')!.onclick = () => commit(() => { if (session.redo()) selected = Math.min(selected, Math.max(0, session.current.slides.length - 1)); selectedElementId = null; });
layoutSelect.onchange = () => { const slide = currentSlide(); if (!slide) return; commit(() => session.commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'update-slide', slideId: slide.id, changes: { layoutId: layoutSelect.value as Slide['layoutId'] } }], '切换布局')); };
selectionEl.onclick = event => { const id = (event.target as HTMLElement).id; const slide = currentSlide(); if (!slide) return; if (id === 'delete-element' && selectedElementId) commit(() => { session.commit({ type: 'element', slideId: slide.id, elementId: selectedElementId! }, [{ type: 'delete-element', slideId: slide.id, elementId: selectedElementId! }], '删除元素'); selectedElementId = null; }); if (id === 'add-text' || id === 'add-list' || id === 'add-citation') commit(() => { const number = slide.elements.length + 1; const element: Element = id === 'add-text' ? { id: crypto.randomUUID(), type: 'text', text: '新增文字' } : id === 'add-list' ? { id: crypto.randomUUID(), type: 'bullet-list', items: ['新增列表项'] } : { id: crypto.randomUUID(), type: 'citation', sourceIds: [fixtureSource.id] }; session.commit({ type: 'slides', slideIds: [slide.id] }, [{ type: 'add-element', slideId: slide.id, element }], '新增元素'); selectedElementId = element.id; }); };
document.querySelector<HTMLButtonElement>('#export')!.onclick = async () => { const snapshot = structuredClone(session.current); try { status = '正在导出'; renderDeck(); const blob = await exportDeck(snapshot, placeholder); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'smartJC-fixture.pptx'; link.click(); URL.revokeObjectURL(url); status = '导出完成'; renderDeck(); } catch (error) { status = error instanceof Error ? error.message : String(error); renderDeck(); } };
document.querySelector<HTMLButtonElement>('#more')!.onclick = () => { status = 'M1 固定 Deck 编辑器'; renderDeck(); };
renderDeck();
