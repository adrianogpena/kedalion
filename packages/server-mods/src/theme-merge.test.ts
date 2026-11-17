import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PALETTES } from '@kedalion/server-core/palettes';
import { loadCustomThemes, listAllThemesFrom, themesDir } from './custom-themes.ts';
import { buildCustomTheme, listAllThemes, mergeTokens, themeNameError } from './theme-merge.ts';

const base = PALETTES[0];

describe('mergeTokens', () => {
  test('overrides defined known keys only', () => {
    const out = mergeTokens(base.tokens, { '--bg': '#123456', '--nope': 'x', '--text': '', '--accent': 5 });
    expect(out['--bg']).toBe('#123456');
    expect(out['--text']).toBe(base.tokens['--text']);
    expect(out['--accent']).toBe(base.tokens['--accent']);
    expect('--nope' in out).toBe(false);
    expect(base.tokens['--bg']).not.toBe('#123456');
  });
  test('missing override leaves base', () => {
    expect(mergeTokens(base.tokens, undefined)).toEqual(base.tokens);
  });
});

describe('themeNameError', () => {
  test.each(['..', 'a/b', 'a\\b', 'C:x', '', '../x', 'a..b'])('rejects %p', (n) => {
    expect(themeNameError(n)).not.toBeNull();
  });
  test('accepts plain names', () => {
    expect(themeNameError('my-theme 2')).toBeNull();
  });
});

describe('buildCustomTheme', () => {
  test('inherits from base id', () => {
    const r = buildCustomTheme('mine', { base: base.id, tokens: { '--bg': '#000001' } }, PALETTES);
    if ('error' in r) throw new Error(r.error);
    expect(r.palette.id).toBe('custom:mine');
    expect(r.palette.kind).toBe(base.kind);
    expect(r.palette.tokens['--bg']).toBe('#000001');
  });
  test('errors', () => {
    expect(buildCustomTheme('x', { base: 'custom:other' }, PALETTES)).toEqual({ error: 'unknown base "custom:other"' });
    expect(buildCustomTheme('x', [], PALETTES)).toHaveProperty('error');
    expect(buildCustomTheme('../x', {}, PALETTES)).toHaveProperty('error');
  });
  test('listAllThemes appends custom', () => {
    const r = buildCustomTheme('mine', {}, PALETTES);
    if ('error' in r) throw new Error(r.error);
    expect(listAllThemes(PALETTES, [r.palette]).length).toBe(PALETTES.length + 1);
  });
});

describe('loadCustomThemes', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  test('missing dir gives nothing', async () => {
    expect(await loadCustomThemes(join(tmpdir(), 'kedalion-no-such-themes'))).toEqual({ themes: [], skipped: [] });
  });

  test('loads good files and skips bad with reasons', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kd-themes-'));
    await writeFile(join(dir, 'good.json'), JSON.stringify({ tokens: { '--bg': '#010203' } }));
    await writeFile(join(dir, 'broken.json'), '{nope');
    await writeFile(join(dir, 'badbase.json'), JSON.stringify({ base: 'zzz' }));
    await writeFile(join(dir, 'note.txt'), 'x');
    const { themes, skipped } = await loadCustomThemes(dir);
    expect(themes.map((t) => t.id)).toEqual(['custom:good']);
    expect(skipped.map((s) => s.name).sort()).toEqual(['badbase', 'broken']);
    const all = await listAllThemesFrom(dir);
    expect(all.themes.length).toBe(PALETTES.length + 1);
  });

  test('themesDir sits under the settings dir', () => {
    expect(themesDir(join('a', 'b'))).toBe(join('a', 'b', 'themes'));
  });
});
