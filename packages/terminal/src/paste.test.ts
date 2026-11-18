import { expect, test } from 'bun:test';
import { continuationOf, pasteNeedsWarning, pasteSummary, placeholderAt, sanitizePaste, trimCopied } from './paste.ts';

const plain = { bracketed: false, shell: 'bash' };

test('a carriage return cannot submit a line', () => {
  expect(sanitizePaste('ls\rrm -rf /', plain)).toBe('lsrm -rf /');
  expect(sanitizePaste('a\r\nb', plain)).toBe('a \\\nb');
});

test('injected bracketed-paste end markers are removed', () => {
  expect(sanitizePaste('echo hi\x1b[201~rm -rf ~', { bracketed: true })).toBe('echo hirm -rf ~');
  expect(sanitizePaste('\x1b[200~x\x1b[201~', { bracketed: true })).toBe('x');
});

test('control characters and escape sequences are removed, tab kept', () => {
  expect(sanitizePaste('a\x03b\x04c\x1bd\x9be\tf', plain)).toBe('abc\tf');
  expect(sanitizePaste('\x1b]0;title\x07x\x1b[31my', plain)).toBe('xy');
});

test('trailing newlines are dropped', () => {
  expect(sanitizePaste('echo hi\n', plain)).toBe('echo hi');
  expect(sanitizePaste('echo hi\n\n\r\n', { bracketed: true })).toBe('echo hi');
});

test('lines join with the shell line continuation unless bracketed', () => {
  expect(sanitizePaste('a\nb', { bracketed: true, shell: 'bash' })).toBe('a\nb');
  expect(sanitizePaste('a\nb', { bracketed: false, shell: 'zsh' })).toBe('a \\\nb');
  expect(sanitizePaste('a\nb', { bracketed: false, shell: 'pwsh' })).toBe('a `\nb');
  expect(sanitizePaste('a\nb', { bracketed: false, shell: 'cmd' })).toBe('a ^\nb');
  expect(sanitizePaste('a\nb', { bracketed: false, shell: 'custom' })).toBe('a b');
  expect(sanitizePaste('a\nb', { bracketed: false })).toBe('a b');
  expect(continuationOf('git-bash')).toBe(' \\\n');
  expect(continuationOf('powershell')).toBe(' `\n');
});

test('warning modes', () => {
  expect(pasteNeedsWarning('a\nb', 'multiLine', 100)).toBe(true);
  expect(pasteNeedsWarning('ab', 'multiLine', 100)).toBe(false);
  expect(pasteNeedsWarning('a\nb', 'large', 100)).toBe(false);
  expect(pasteNeedsWarning('x'.repeat(101), 'large', 100)).toBe(true);
  expect(pasteNeedsWarning('x'.repeat(101), 'multiLine', 100)).toBe(true);
  expect(pasteNeedsWarning('a\nb'.repeat(500), 'never', 100)).toBe(false);
});

test('summary counts lines without the trailing break', () => {
  expect(pasteSummary('a\nb\n')).toEqual({ lines: 2, chars: 4, preview: 'a\nb' });
  expect(pasteSummary('1\n2\n3', 2).preview).toBe('1\n2\n…');
});

test('copied lines lose trailing spaces', () => {
  expect(trimCopied('a   \nb \n  c')).toBe('a\nb\n  c');
});

const holders = 'x [Pasted text #1 +20 lines] y [Pasted text #2 +5 lines]';

test('placeholderAt picks the placeholder under or before the column', () => {
  expect(placeholderAt(holders, 5)).toEqual({ n: 1, lines: 20 });
  expect(placeholderAt(holders, 40)).toEqual({ n: 2, lines: 5 });
  expect(placeholderAt(holders, 0)).toEqual({ n: 1, lines: 20 });
});

test('placeholderAt is null without a placeholder', () => {
  expect(placeholderAt('plain', 2)).toBeNull();
});
