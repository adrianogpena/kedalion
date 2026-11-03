import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paletteById } from '@kedalion/server-core/palettes';
import { type BaseSettings, settingsStore } from './settings.ts';
import { themeHead, themeHtml } from './theme-head.ts';

const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <link rel="stylesheet" crossorigin href="/assets/index.css">
  </head>
  <body></body>
</html>`;

const bg = (id: string) => paletteById(id)!.tokens['--bg'];

test('dark: the palette tokens go after the stylesheet link, data-theme stays dark', () => {
  const out = themeHtml(HTML, { theme: 'dark', paletteDark: 'nord' });
  expect(out).toContain('<html lang="en" data-theme="dark" data-layout="ribbon" data-nav="header" data-density="normal" data-skin="base">');
  const style = out.indexOf('<style id="kedalion-theme">:root[data-theme]{color-scheme:dark;');
  expect(style).toBeGreaterThan(out.indexOf('<link rel="stylesheet"'));
  expect(style).toBeLessThan(out.indexOf('</head>'));
  expect(out).toContain(`--bg:${bg('nord')};`);
  expect(out).not.toContain('@media');
});

test('light: data-theme becomes light and the light palette is emitted', () => {
  const out = themeHtml(HTML, { theme: 'light', paletteLight: 'solarized-light' });
  expect(out).toContain('<html lang="en" data-theme="light" data-layout="ribbon" data-nav="header" data-density="normal" data-skin="base">');
  expect(out).toContain(`:root[data-theme]{color-scheme:light;--bg:${bg('solarized-light')};`);
});

test('system: dark palette, then the light one under prefers-color-scheme', () => {
  const out = themeHtml(HTML, { theme: 'system', paletteDark: 'dracula' });
  expect(out).toContain('data-theme="dark"');
  const dark = out.indexOf(`--bg:${bg('dracula')};`);
  const media = out.indexOf('@media (prefers-color-scheme: light){:root[data-theme]{color-scheme:light;');
  expect(dark).toBeGreaterThan(0);
  expect(media).toBeGreaterThan(dark);
  expect(out.slice(media)).toContain(`--bg:${bg('alucard')};`);
});

test('html without a head is left alone', () => {
  expect(themeHtml('<p>hi</p>', { theme: 'dark' })).toBe('<p>hi</p>');
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('themeHead reads the saved settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-theme-'));
  dirs.push(dir);
  const store = settingsStore<BaseSettings>({ dir, defaults: { theme: 'dark' } });
  await store.save({ theme: 'light', paletteLight: 'catppuccin-latte' });
  expect(await themeHead(store)(HTML)).toContain(`--bg:${bg('catppuccin-latte')};`);
});

test('data-layout is inserted, replaced, and an unknown id falls back to the default layout', () => {
  expect(themeHtml(HTML, { theme: 'dark' })).toContain('<html lang="en" data-theme="dark" data-layout="ribbon" data-nav="header" data-density="normal" data-skin="base">');
  const withLayout = HTML.replace('<html lang="en"', '<html lang="en" data-layout="x"');
  const out = themeHtml(withLayout, { theme: 'system', layout: 'original' });
  expect(out).toContain('data-layout="original"');
  expect(out).not.toContain('data-layout="x"');
  expect(themeHtml(HTML, { theme: 'dark', layout: 'nope' })).toContain('data-layout="ribbon"');
});

test('the four layout attributes follow the layouts setting', () => {
  const out = themeHtml(HTML, { theme: 'dark', layouts: { preset: 'bridge' } });
  expect(out).toContain('data-layout="bridge" data-nav="header-command" data-density="normal" data-skin="base"');
  const legacy = themeHtml(HTML, { theme: 'dark', layout: 'dense' });
  expect(legacy).toContain('data-layout="dense"');
  expect(legacy).toContain('data-density="compact"');
});
