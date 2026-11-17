import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupBeforeMigrate, cycleFormat, formatById, lenientEntries, lenientFields, migrateSettings, type FormatOption, type MigrationStep } from './settings-migrate.ts';

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

describe('lenient parsing and backup', () => {
  test('lenientFields falls back per field and keeps unknown keys', () => {
    const r = lenientFields({ size: 'big', name: 'x', extra: 1 }, { size: 12, name: '', flag: true }, { size: (v) => typeof v === 'number', name: (v) => typeof v === 'string' });
    expect(r.value as Record<string, unknown>).toEqual({ size: 12, name: 'x', flag: true, extra: 1 });
    expect(r.rejected).toEqual(['size']);
    expect(lenientFields('junk', { a: 1 }, {}).value).toEqual({ a: 1 });
  });

  test('lenientEntries drops only bad entries', () => {
    const r = lenientEntries({ a: 1, b: 'no', c: 3 }, (v): v is number => typeof v === 'number');
    expect(r.value).toEqual({ a: 1, c: 3 });
    expect(r.rejected).toEqual(['b']);
  });

  test('backupBeforeMigrate keeps the first copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kmig-'));
    try {
      const file = join(dir, 'settings.json');
      expect(await backupBeforeMigrate(file, ['x'])).toBeUndefined();
      await writeFile(file, 'one');
      expect(await backupBeforeMigrate(file, [])).toBeUndefined();
      const bak = await backupBeforeMigrate(file, ['proto/v2']);
      expect(bak).toBe(`${file}.pre-proto_v2.bak`);
      await writeFile(file, 'two');
      expect(await backupBeforeMigrate(file, ['proto/v2'])).toBe(bak);
      expect(await readFile(bak!, 'utf8')).toBe('one');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
