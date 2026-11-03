import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutsFromLegacy, resolveLayouts } from '@kedalion/server-core/layouts';
import { type BaseSettings, settingsStore } from './settings.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store(file?: object) {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-settings-'));
  dirs.push(dir);
  if (file) await writeFile(join(dir, 'settings.json'), JSON.stringify(file));
  return { dir, store: settingsStore<BaseSettings>({ dir, defaults: { theme: 'dark' } }) };
}

test('theme and palettes of the right kind are saved', async () => {
  const { dir, store: s } = await store();
  await s.save({ theme: 'system', paletteDark: 'dracula', paletteLight: 'alucard' });
  expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({
    theme: 'system',
    paletteDark: 'dracula',
    paletteLight: 'alucard',
  });
  expect(await s.save({ theme: 'light' })).toMatchObject({ theme: 'light' });
});

test('wrong-kind, unknown and malformed values are ignored, an empty string clears', async () => {
  const { store: s } = await store();
  await s.save({ paletteDark: 'nord', paletteLight: 'catppuccin-latte' });
  expect(await s.save({ theme: 'blue', paletteDark: 'alucard', paletteLight: 'nope' })).toEqual({
    theme: 'dark',
    paletteDark: 'nord',
    paletteLight: 'catppuccin-latte',
  });
  expect(await s.save({ paletteDark: 42, paletteLight: '' })).toEqual({ theme: 'dark', paletteDark: 'nord' });
});

test('an existing settings file keeps working', async () => {
  const { store: s } = await store({ theme: 'light', language: 'pt-BR' });
  expect(await s.load()).toEqual({ theme: 'light', language: 'pt-BR' });
});

test('a corrupt settings file is renamed aside and defaults load', async () => {
  const { dir, store: s } = await store();
  await writeFile(join(dir, 'settings.json'), '{ nope');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await s.load()).toEqual({ theme: 'dark' });
  } finally {
    err.mockRestore();
  }
  expect((await readdir(dir)).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true);
});

test('settings that are not a plain object count as corrupt', async () => {
  const { dir, store: s } = await store();
  await writeFile(join(dir, 'settings.json'), '[1, 2]');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await s.load()).toEqual({ theme: 'dark' });
  } finally {
    err.mockRestore();
  }
  expect((await readdir(dir)).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true);
});

test('icons is saved when known, ignored when unknown, cleared by an empty string', async () => {
  const { store: s } = await store();
  expect(await s.save({ icons: 'original' })).toEqual({ theme: 'dark', icons: 'original' });
  expect(await s.save({ icons: 'nope' })).toEqual({ theme: 'dark', icons: 'original' });
  expect(await s.save({ icons: '' })).toEqual({ theme: 'dark' });
});

test('stored layout and mainMenu migrate to layouts on load', async () => {
  const { store: s } = await store({ theme: 'dark', layout: 'material', mainMenu: 'icons' });
  const loaded = await s.load();
  expect(loaded).toEqual({ theme: 'dark', layouts: layoutsFromLegacy({ layout: 'material', mainMenu: 'icons' }) });
  expect(loaded.layouts?.skin).toBe('material');
  expect(resolveLayouts(loaded.layouts).nav.labels).toBe(false);
});

test('a valid layouts patch is saved and the old keys are dropped', async () => {
  const { dir, store: s } = await store({ theme: 'dark' });
  const saved = await s.save({ layouts: { preset: 'ribbon' } });
  expect(saved.layouts).toEqual({ preset: 'ribbon' });
  expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark', layouts: { preset: 'ribbon' } });
  expect(await s.save({ layouts: { preset: 'nope' } })).toEqual(saved);
  expect(await s.save({ layouts: '' })).toEqual({ theme: 'dark' });
});

test('a conflicting layouts patch is rejected and nothing is written', async () => {
  const { dir, store: s } = await store({ theme: 'dark' });
  const before = await readFile(join(dir, 'settings.json'), 'utf8');
  await expect(s.save({ layouts: { preset: 'original', navigation: 'sidebar', skin: 'ledger' } })).rejects.toMatchObject({ code: 'layoutConflict' });
  expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(before);
  expect(await s.load()).toEqual({ theme: 'dark' });
});

test('legacy layout, mainMenu and dock patches are converted to layouts', async () => {
  const { store: s } = await store();
  const saved = await s.save({ layout: 'material', mainMenu: 'icons', dock: 'right' });
  expect(saved).toEqual({ theme: 'dark', layouts: layoutsFromLegacy({ layout: 'material', mainMenu: 'icons', dock: 'right' }) });
  expect(await s.save({ layout: 'nope' })).toEqual(saved);
  expect(await s.save({ layout: '' })).toEqual({ theme: 'dark' });
});

test('reload picks up an edit made outside the app', async () => {
  const { dir, store: s } = await store({ theme: 'light' });
  expect((await s.reload()).changed).toBe(false);
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ theme: 'system' }));
  expect(await s.reload()).toEqual({ changed: true, settings: { theme: 'system' } });
  expect((await s.reload()).changed).toBe(false);
});
