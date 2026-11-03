import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SavedTarget {
  text?: string;
  selector?: string;
  label?: string;
}

/** origin -> name -> target. */
export type TargetStore = Record<string, Record<string, SavedTarget>>;

export const targetsFile = (dataDir: string): string => join(dataDir, 'targets.json');

export function loadTargets(file: string): TargetStore {
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as TargetStore) : {};
  } catch {
    return {};
  }
}

export function saveTargets(file: string, store: TargetStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, file);
}

export function setTarget(file: string, origin: string, name: string, target: SavedTarget): void {
  const store = loadTargets(file);
  store[origin] = { ...store[origin], [name]: target };
  saveTargets(file, store);
}

export function removeTarget(file: string, origin: string, name: string): boolean {
  const store = loadTargets(file);
  if (!store[origin]?.[name]) return false;
  delete store[origin][name];
  if (!Object.keys(store[origin]).length) delete store[origin];
  saveTargets(file, store);
  return true;
}

export const getTarget = (file: string, origin: string, name: string): SavedTarget | undefined => loadTargets(file)[origin]?.[name];
