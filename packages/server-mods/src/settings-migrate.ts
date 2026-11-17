import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';

export interface MigrationStep {
  id: string;
  /** Returns the migrated settings (may mutate a copy); `warn` reports unknown legacy values. */
  migrate(old: Record<string, unknown>, warn: (message: string) => void): Record<string, unknown>;
}

export interface MigrationResult {
  settings: Record<string, unknown>;
  applied: string[];
  warnings: string[];
}

/** Key under which the ids of applied one-shot steps are recorded. */
export const MIGRATIONS_KEY = 'migrations';

/** Runs each step whose id is not yet recorded in `settings.migrations`, once, in order. */
export function migrateSettings(settings: Record<string, unknown>, steps: readonly MigrationStep[]): MigrationResult {
  const done = Array.isArray(settings[MIGRATIONS_KEY]) ? (settings[MIGRATIONS_KEY] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const applied: string[] = [];
  const warnings: string[] = [];
  let current = { ...settings };
  for (const step of steps) {
    if (done.includes(step.id)) continue;
    current = step.migrate({ ...current }, (m) => warnings.push(`${step.id}: ${m}`));
    done.push(step.id);
    applied.push(step.id);
  }
  if (applied.length) current[MIGRATIONS_KEY] = done;
  return { settings: current, applied, warnings };
}

/**
 * Copies the settings file to `<file>.pre-<first applied id>.bak` before a migrated copy replaces it.
 * The first backup for an id wins (a later run never overwrites it). Returns the backup path, or undefined
 * when nothing was applied, the file is missing or the copy failed: a failed backup must not block the save.
 */
export async function backupBeforeMigrate(file: string, applied: readonly string[]): Promise<string | undefined> {
  if (!applied.length) return undefined;
  const target = `${file}.pre-${applied[0]!.replace(/[^\w.-]/g, '_')}.bak`;
  try {
    await copyFile(file, target, constants.COPYFILE_EXCL);
    return target;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EEXIST' ? target : undefined;
  }
}

export interface LenientResult<T> {
  value: T;
  /** Keys whose stored value was invalid and fell back to the default (or, for entries, was dropped). */
  rejected: string[];
}

/**
 * Per-field fallback: each key of `defaults` takes the stored value when `valid[key]` accepts it, else the
 * default, so one bad field never resets the whole file. Unknown keys are kept as stored.
 */
export function lenientFields<T extends Record<string, unknown>>(
  raw: unknown,
  defaults: T,
  valid: { [K in keyof T]?: (v: unknown) => boolean },
): LenientResult<T> {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const value: Record<string, unknown> = { ...stored };
  const rejected: string[] = [];
  for (const key of Object.keys(defaults)) {
    const check = valid[key as keyof T];
    if (!(key in stored)) value[key] = defaults[key];
    else if (check && !check(stored[key])) {
      value[key] = defaults[key];
      rejected.push(key);
    }
  }
  return { value: value as T, rejected };
}

/** A map with only the entries `valid` accepts; the dropped keys are listed. */
export function lenientEntries<V>(raw: unknown, valid: (v: unknown) => v is V): LenientResult<Record<string, V>> {
  const value: Record<string, V> = {};
  const rejected: string[] = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (valid(v)) value[k] = v;
      else rejected.push(k);
    }
  }
  return { value, rejected };
}

export interface FormatOption {
  id: string;
  label: string;
  format: string;
}

/** The option with `id`, else the first. */
export function formatById(list: readonly FormatOption[], id: string | undefined): FormatOption {
  return list.find((f) => f.id === id) ?? list[0];
}

/** The id after `id` in the list, wrapping; an unknown id gives the first. */
export function cycleFormat(list: readonly FormatOption[], id: string | undefined): FormatOption {
  const i = list.findIndex((f) => f.id === id);
  return list[(i + 1) % list.length];
}
