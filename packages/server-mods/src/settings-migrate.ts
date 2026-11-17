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
