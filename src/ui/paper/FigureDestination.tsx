import { useEffect, useId, useRef, useState } from 'react';
import type { Paper } from '../../modules/paper/model';
import { inputClass } from '../controls';
export function FigureDestinationInput({
  paper,
  value,
  selectedId,
  onChange,
}: {
  paper: Paper;
  value: string;
  selectedId?: string;
  onChange: (value: string, selectedId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="relative">
      <input
        ref={input}
        role="combobox"
        aria-label="原图号"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        value={value}
        className={inputClass}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label="已有图号"
          className="absolute inset-x-0 top-full z-30 max-h-56 overflow-y-auto rounded border border-line bg-white shadow-lg"
        >
          {paper.figures
            .filter(
              (figure) =>
                !value || figure.label?.toLowerCase().includes(value.toLowerCase()) || figure.id === selectedId,
            )
            .map((figure) => {
              const source = paper.sources.find((item) => item.id === figure.regions[0].sourceId)!;
              const doc = paper.documents.find((item) => item.id === source.documentId)!;
              return (
                <button
                  key={figure.id}
                  type="button"
                  role="option"
                  aria-selected={selectedId === figure.id}
                  className="block w-full cursor-pointer border-b border-line px-3 py-2 text-left text-xs hover:bg-panel"
                  onClick={() => {
                    onChange(figure.label ?? '', figure.id);
                    setOpen(false);
                  }}
                >
                  {figure.label || '未标号 Figure'} · {doc.role === 'primary' ? '主论文' : '补充材料'} · {doc.fileName}{' '}
                  第 {source.pageNumber} 页
                </button>
              );
            })}
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-muted"
            onClick={() => setOpen(false)}
          >
            收起列表 · 输入新图号可创建独立图
          </button>
        </div>
      )}
    </div>
  );
}
