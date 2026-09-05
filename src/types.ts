export type BBox = { x: number; y: number; width: number; height: number };
export type LayoutId = 'title' | 'text-only' | 'figure-full' | 'figure-text' | 'two-figures' | 'panel-grid';
export type Element =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'bullet-list'; items: string[] }
  | { id: string; type: 'figure'; figureId: string; cropOverride?: BBox };
export type Slide = { id: string; title: string; message?: string; layoutId: LayoutId; elements: Element[] };
export type Deck = { schemaVersion: 1; id: string; revision: number; title: string; language: string; slides: Slide[] };
