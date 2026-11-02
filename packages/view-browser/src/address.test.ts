import { expect, test } from 'bun:test';
import { normalizeAddress } from './address.ts';

test('keeps URLs with a scheme', () => {
  expect(normalizeAddress('https://a.b/c')).toBe('https://a.b/c');
  expect(normalizeAddress('about:blank')).toBe('about:blank');
  expect(normalizeAddress('file:///c:/x.html')).toBe('file:///c:/x.html');
});

test('hosts get http for localhost and https otherwise', () => {
  expect(normalizeAddress('localhost:4200')).toBe('http://localhost:4200');
  expect(normalizeAddress('127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000/x');
  expect(normalizeAddress('a.b')).toBe('https://a.b');
  expect(normalizeAddress(' example.com/path?q=1 ')).toBe('https://example.com/path?q=1');
});

test('anything else is a search', () => {
  expect(normalizeAddress('hello world')).toBe('https://www.bing.com/search?q=hello%20world');
  expect(normalizeAddress('cats')).toBe('https://www.bing.com/search?q=cats');
  expect(normalizeAddress('a.b c')).toBe('https://www.bing.com/search?q=a.b%20c');
});

test('empty is a blank page', () => {
  expect(normalizeAddress('  ')).toBe('about:blank');
});
