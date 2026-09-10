import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../controls';

export function ProjectDialog({
  title,
  children,
  busy = false,
  onClose,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const trapFocus = (event: FocusEvent) => {
      const element = panel.current;
      if (element?.getClientRects().length && event.target instanceof Node && !element.contains(event.target))
        element.focus();
    };
    panel.current?.querySelector<HTMLElement>('button, input, textarea, select')?.focus();
    document.addEventListener('focusin', trapFocus);
    return () => {
      document.removeEventListener('focusin', trapFocus);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (busy) panel.current?.focus();
  }, [busy]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/25 p-6">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90dvh] w-[780px] overflow-y-auto rounded-lg border border-line bg-white p-6 text-ink shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (!busy) onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          if (!controls.length) {
            event.preventDefault();
            return;
          }
          if (document.activeElement === panel.current) {
            event.preventDefault();
            controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
            return;
          }
          const first = controls[0];
          const last = controls.at(-1);
          if (
            (event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium">{title}</h2>
          <IconButton label={`关闭${title}`} disabled={busy} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
