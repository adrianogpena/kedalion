import { useSyncExternalStore } from 'react';

/** A source must stay busy this long before its view counts as busy, so quick commands like `ls` never animate the nav icon. */
export const BUSY_DELAY_MS = 1200;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const active = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

const emit = () => {
  const views = new Set<string>();
  for (const key of active) views.add(key.split('\0')[0]!);
  snapshot = views;
  for (const l of listeners) l();
};

/** Marks `source` (e.g. a terminal tab) of view `viewId` as busy or idle; the view shows as busy once any source has been busy for BUSY_DELAY_MS. */
export function setViewBusy(viewId: string, source: string, busy: boolean): void {
  const key = `${viewId}\0${source}`;
  if (busy) {
    if (active.has(key) || pending.has(key)) return;
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      active.add(key);
      emit();
    }, BUSY_DELAY_MS));
    return;
  }
  const timer = pending.get(key);
  if (timer) {
    clearTimeout(timer);
    pending.delete(key);
  }
  if (active.delete(key)) emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** True while a source of view `viewId` has a long-running job (see setViewBusy). */
export const useViewBusy = (viewId: string): boolean => useSyncExternalStore(subscribe, () => snapshot, () => snapshot).has(viewId);
