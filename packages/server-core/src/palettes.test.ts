import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  PALETTES,
  TOKENS,
  effectiveKind,
  familySibling,
  paletteFor,
  resolvePalette,
} from './palettes.ts';

const COLOUR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/;

function cssBlock(selector: string): Record<string, string> {
  const css = readFileSync(join(import.meta.dir, '../../ui/src/styles.css'), 'utf8');
  const body = css.slice(css.indexOf(selector) + selector.length).split('}')[0]!;
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]));
}

test('every palette has every token, colours are valid and ids unique', () => {
  for (const p of PALETTES) expect(Object.keys(p.tokens).sort()).toEqual([...TOKENS].sort());
  const invalid = PALETTES.flatMap((p) =>
    TOKENS.filter((t) => t !== '--shadow' && !COLOUR.test(p.tokens[t])).map((t) => `${p.id} ${t} ${p.tokens[t]}`),
  );
  expect(invalid).toEqual([]);
  expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
  expect(PALETTES.length).toBe(29);
});

test('kedalion-dark is the dark block of styles.css plus the new tokens', () => {
  const { '--font-mono': _, ...css } = cssBlock(":root[data-theme='dark'] {");
  const tokens = resolvePalette('dark', 'kedalion-dark').tokens as Record<string, string>;
  expect(tokens).toEqual(css);
  expect([tokens['--side-active'], tokens['--backdrop'], tokens['--ink-on-err']]).toEqual(['#1f1c33', 'rgba(3, 7, 12, 0.55)', '#333333']);
});

test('resolve: saved id of the kind wins, else the other side family, else the default', () => {
  expect(resolvePalette('dark', 'nord').id).toBe('nord');
  expect(resolvePalette('dark', 'nope').id).toBe(DEFAULT_DARK);
  expect(resolvePalette('light', 'nord').id).toBe(DEFAULT_LIGHT);
  expect(resolvePalette('light', undefined, 'dracula').id).toBe('alucard');
  expect(resolvePalette('light', 'dracula', 'dracula').id).toBe('alucard');
  expect(resolvePalette('light', undefined, 'nord').id).toBe(DEFAULT_LIGHT);
  expect(resolvePalette('light', 'gruvbox-light', 'dracula').id).toBe('gruvbox-light');
  expect(resolvePalette('dark', undefined, 'alucard').id).toBe('dracula');
  expect(resolvePalette('dark', undefined, DEFAULT_LIGHT).id).toBe(DEFAULT_DARK);
  expect(familySibling('catppuccin-mocha', 'light')?.id).toBe('catppuccin-latte');
  expect(familySibling('nord', 'light')).toBeUndefined();
});

test('paletteFor follows the preference, and the system kind only for system', () => {
  expect(effectiveKind('system', 'light')).toBe('light');
  expect(effectiveKind('dark', 'light')).toBe('dark');
  expect(paletteFor({ theme: 'system', paletteDark: 'nord', paletteLight: 'alucard' }, 'dark').id).toBe('nord');
  expect(paletteFor({ theme: 'system', paletteDark: 'nord', paletteLight: 'alucard' }, 'light').id).toBe('alucard');
  expect(paletteFor({ theme: 'light', paletteDark: 'dracula' }, 'dark').id).toBe('alucard');
  expect(paletteFor({ theme: 'dark' }, 'light').id).toBe(DEFAULT_DARK);
});
