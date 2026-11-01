import { expect, test } from 'bun:test';
import { DEFAULT_LINK_SETTINGS, resolveLinkTarget, routableUrl } from '../src/links.ts';

const base = 'http://localhost:5173/app';

test('resolveLinkTarget: innermost scope wins, else the global setting', () => {
  const s = { openIn: 'internal' as const, scopes: { a: 'external' as const, b: 'internal' as const } };
  expect(resolveLinkTarget([], s)).toBe('internal');
  expect(resolveLinkTarget(['x', 'a'], s)).toBe('external');
  expect(resolveLinkTarget(['b', 'a'], s)).toBe('internal');
  expect(resolveLinkTarget(['a', 'b'], s)).toBe('external');
  expect(resolveLinkTarget(['toString'], s)).toBe('internal');
});

test('default settings send ticket and PR panels to the default browser', () => {
  expect(resolveLinkTarget(['panel:tickets'], DEFAULT_LINK_SETTINGS)).toBe('external');
  expect(resolveLinkTarget(['panel:other'], DEFAULT_LINK_SETTINGS)).toBe('internal');
});

test('routableUrl: external http(s) only', () => {
  expect(routableUrl('https://example.com/x', base)).toBe('https://example.com/x');
  expect(routableUrl('http://localhost:5174/', base)).toBe('http://localhost:5174/');
  expect(routableUrl('http://localhost:5173/other', base)).toBeNull();
  expect(routableUrl('/relative', base)).toBeNull();
  expect(routableUrl('#hash', base)).toBeNull();
  expect(routableUrl('mailto:a@b.c', base)).toBeNull();
  expect(routableUrl('file:///c:/x', base)).toBeNull();
  expect(routableUrl('', base)).toBeNull();
  expect(routableUrl(null, base)).toBeNull();
});
