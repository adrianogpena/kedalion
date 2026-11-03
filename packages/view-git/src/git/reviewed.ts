import { useSyncExternalStore } from 'react';
import type { GitFile } from '@kedalion/server-core/protocol';

const reviewed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  for (const l of listeners) l();
};

/** Key of one file state: a file whose line counts change becomes unreviewed. */
export const reviewKey = (project: string, file: Pick<GitFile, 'path' | 'added' | 'removed'>) =>
  `${project}\0${file.path}\0${file.added ?? ''}\0${file.removed ?? ''}`;

export const isReviewed = (key: string) => reviewed.has(key);

export function markReviewed(keys: string[]) {
  let changed = false;
  for (const k of keys) {
    if (!reviewed.has(k)) {
      reviewed.add(k);
      changed = true;
    }
  }
  if (changed) emit();
}

export function clearReviewed() {
  if (reviewed.size === 0) return;
  reviewed.clear();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Re-renders on change; returns the lookup. */
export function useReviewed(): (key: string) => boolean {
  useSyncExternalStore(subscribe, () => version);
  return isReviewed;
}
