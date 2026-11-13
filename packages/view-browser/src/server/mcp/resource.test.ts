import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileNameFor, sniffMime, uniqueFile } from './resource.ts';
import { defaultPattern, matchesPattern, pageKey } from './tools-content.ts';

const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(16).fill(0)]);

test('sniffMime reads the real type from the bytes', () => {
  expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
  expect(sniffMime(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
  expect(sniffMime(bytes(0x47, 0x49, 0x46, 0x38))).toBe('image/gif');
  expect(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
  expect(sniffMime(new TextEncoder().encode('  <svg xmlns="x"></svg>'))).toBe('image/svg+xml');
  expect(sniffMime(new TextEncoder().encode('<!DOCTYPE html><html>'))).toBe('text/html');
  expect(sniffMime(bytes(1, 2, 3))).toBeUndefined();
});

test('fileNameFor takes the file-like segment and the real extension', () => {
  expect(fileNameFor('https://static.example/images/4/47/I_beet_crop.png/revision/latest', 'image/webp')).toBe('I_beet_crop.webp');
  expect(fileNameFor('https://cdn.example/ew/a/a3/Graveyard_Keeper_Pallet.png', 'image/png')).toBe('Graveyard_Keeper_Pallet.png');
  expect(fileNameFor('https://x.test/photo.jpeg?w=200', 'image/jpeg')).toBe('photo.jpeg');
  expect(fileNameFor('https://x.test/a%20b%3F.gif', undefined)).toBe('a b_.gif');
  expect(fileNameFor('https://x.test/', 'image/png')).toBe('x.test.png');
});

test('uniqueFile numbers names that are taken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kd-res-'));
  writeFileSync(join(dir, 'a.png'), '');
  const taken = new Set<string>();
  expect(uniqueFile(dir, 'a.png', taken)).toBe(join(dir, 'a-2.png'));
  expect(uniqueFile(dir, 'a.png', taken)).toBe(join(dir, 'a-3.png'));
  expect(uniqueFile(dir, 'b.png', taken)).toBe(join(dir, 'b.png'));
});

test('crawl patterns match prefixes, globs and paths', () => {
  expect(defaultPattern('https://www.neoseeker.com/graveyard-keeper/walkthrough')).toBe('https://www.neoseeker.com/graveyard-keeper/');
  expect(defaultPattern('https://wiki.test/wiki/Items')).toBe('https://wiki.test/wiki/');
  expect(matchesPattern('https://wiki.test/wiki/Beet', 'https://wiki.test/wiki/')).toBe(true);
  expect(matchesPattern('https://other.test/wiki/Beet', 'https://wiki.test/wiki/')).toBe(false);
  expect(matchesPattern('https://wiki.test/wiki/Beet', '/wiki/*')).toBe(true);
  expect(matchesPattern('https://wiki.test/w/index.php?title=Beet', '/wiki/*')).toBe(false);
  expect(matchesPattern('https://n.test/gk/walkthrough/Intro', 'https://n.test/gk/walkthrough/*')).toBe(true);
  expect(pageKey('https://wiki.test/wiki/Beet#Recipe')).toBe('https://wiki.test/wiki/Beet');
});
