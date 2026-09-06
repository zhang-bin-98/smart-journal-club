const activities = new Set<symbol>();
const dirty = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function beginActivity() {
  const token = Symbol(); activities.add(token); notify();
  return () => { if (activities.delete(token)) notify(); };
}
export function setDirty(key: string, value: boolean) {
  const changed = value ? !dirty.has(key) : dirty.has(key);
  if (value) dirty.add(key); else dirty.delete(key);
  if (changed) notify();
}
export const isAppIdle = () => activities.size === 0 && dirty.size === 0;
export function subscribeActivity(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export type LeaveGuard = () => Promise<void>;
export type RegisterLeaveGuard = (guard?: LeaveGuard) => void;
