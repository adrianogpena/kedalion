import { describe, expect, test } from 'bun:test';
import { blend, cssColorMix, hunkBg, parseHex } from '../src/color-mix';
import { isBinaryExtension, summarizeDiff } from '../src/diff-summary';

describe('isBinaryExtension', () => {
  test('matches case-insensitively by last extension', () => {
    expect(isBinaryExtension('a/b/Logo.PNG')).toBe(true);
    expect(isBinaryExtension('x.tar.gz')).toBe(true);
    expect(isBinaryExtension('main.ts')).toBe(false);
    expect(isBinaryExtension('.db')).toBe(false);
    expect(isBinaryExtension('png')).toBe(false);
  });
});

describe('summarizeDiff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '--- sql comment',
    '+++ added plus',
    ' end',
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+x',
    '+y',
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    '@@ -1 +0,0 @@',
    '-z',
    'diff --git a/o.ts b/n.ts',
    'similarity index 90%',
    'rename from o.ts',
    'rename to n.ts',
    'diff --git a/i.png b/i.png',
    'Binary files a/i.png and b/i.png differ',
  ].join('\n');

  test('statuses, counts, renames and binaries', () => {
    expect(summarizeDiff(diff)).toEqual([
      { path: 'src/a.ts', status: 'M', added: 1, deleted: 1, binary: false },
      { path: 'new.txt', status: 'A', added: 2, deleted: 0, binary: false },
      { path: 'old.txt', status: 'D', added: 0, deleted: 1, binary: false },
      { path: 'n.ts', oldPath: 'o.ts', status: 'R', added: 0, deleted: 0, binary: false },
      { path: 'i.png', status: 'M', added: 0, deleted: 0, binary: true },
    ]);
  });
});

describe('color mix', () => {
  test('parses and blends hex colours', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('red')).toBeNull();
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(blend('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(blend('nope', '#ffffff', 0.5)).toBe('nope');
    expect(hunkBg('#000000', '#ff0000', 0.5)).toBe('#800000');
    expect(cssColorMix('var(--ok)', 'var(--bg)', 18)).toBe('color-mix(in srgb, var(--ok) 18%, var(--bg))');
  });
});
