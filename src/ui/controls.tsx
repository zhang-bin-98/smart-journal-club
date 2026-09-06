import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const inputClass = 'w-full rounded border border-control bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-focus disabled:opacity-45';
export function Button({ children, primary, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...props} className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-xs leading-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45 ${primary ? 'border-accent bg-accent text-white enabled:hover:bg-accent/90' : 'border-control bg-white text-ink enabled:hover:border-accent'} ${className}`}>{children}</button>;
}
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <Button {...props} title={label} aria-label={label} className="size-9 p-2">{children}</Button>;
}
export function Brand() {
  return <div className="flex shrink-0 items-center gap-2.5"><span className="grid size-8 place-items-center rounded bg-accent text-xs font-bold text-white">JC</span><span className="text-lg font-semibold">smartJC</span></div>;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const changed = () => setOnline(navigator.onLine); window.addEventListener('online', changed); window.addEventListener('offline', changed); return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }; }, []);
  return online;
}
