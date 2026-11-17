import { describe, expect, test } from 'bun:test';
import { cycleFormat, formatById, migrateSettings, type FormatOption, type MigrationStep } from './settings-migrate.ts';

const steps: MigrationStep[] = [
  {
    id: 'proto-v2',
    migrate(old, warn) {
      const p = old.proto;
      delete old.proto;
      if (p === 'a') old.protocol = 'alpha';
      else if (p !== undefined) warn(`unknown proto ${String(p)}`);
      return old;
    },
  },
];

describe('migrateSettings', () => {
  test('applies once and records', () => {
    const r = migrateSettings({ proto: 'a', keep: 1 }, steps);
    expect(r.settings).toEqual({ protocol: 'alpha', keep: 1, migrations: ['proto-v2'] });
    expect(r.applied).toEqual(['proto-v2']);
    const again = migrateSettings(r.settings, steps);
    expect(again.applied).toEqual([]);
    expect(again.settings).toEqual(r.settings);
  });
  test('warns on unknown legacy value and does not mutate input', () => {
    const input = { proto: 'zzz' };
    const r = migrateSettings(input, steps);
    expect(r.warnings).toEqual(['proto-v2: unknown proto zzz']);
    expect(input).toEqual({ proto: 'zzz' });
  });
});

describe('format list', () => {
  const list: FormatOption[] = [
    { id: 'iso', label: 'ISO', format: 'YYYY-MM-DD' },
    { id: 'us', label: 'US', format: 'MM/DD/YYYY' },
  ];
  test('cycle wraps and unknown goes to first', () => {
    expect(cycleFormat(list, 'iso').id).toBe('us');
    expect(cycleFormat(list, 'us').id).toBe('iso');
    expect(cycleFormat(list, 'x').id).toBe('iso');
  });
  test('formatById falls back to first', () => {
    expect(formatById(list, 'us').format).toBe('MM/DD/YYYY');
    expect(formatById(list, undefined).id).toBe('iso');
  });
});
