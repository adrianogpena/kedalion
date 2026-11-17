import { expect, test } from 'bun:test';
import { hunkToPatch, retargetPatch, splitDiff } from './git-patch.ts';

const diff = ['diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', '@@ -10 +10 @@', '-x', '\\ No newline at end of file', '+y', '\\ No newline at end of file', ''].join('\n');

test('splits header and hunks', () => {
  const s = splitDiff(diff);
  expect(s.header).toHaveLength(4);
  expect(s.hunks).toHaveLength(2);
});

test('builds a patch with header and the chosen hunk only', () => {
  const p = hunkToPatch(diff, 1)!;
  expect(p.startsWith('diff --git a/f b/f\n')).toBe(true);
  expect(p).toContain('@@ -10 +10 @@');
  expect(p).not.toContain('@@ -1,2');
  expect(p.match(/\ No newline/g)).toHaveLength(2);
  expect(p.endsWith('\n')).toBe(true);
});

test('keeps CRLF content lines', () => {
  const p = hunkToPatch('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\r\n+b\r\n', 0)!;
  expect(p).toContain('-a\r\n+b\r\n');
});

test('missing hunk and binary give undefined', () => {
  expect(hunkToPatch(diff, 2)).toBeUndefined();
  expect(hunkToPatch('diff --git a/f b/f\nBinary files a/f and b/f differ\n', 0)).toBeUndefined();
});

test('retargetPatch rewrites headers, drops rename lines, keeps /dev/null', () => {
  const p = ['diff --git a/old.ts b/new.ts', 'similarity index 90%', 'rename from old.ts', 'rename to new.ts', 'index 1..2 100644', '--- a/old.ts', '+++ b/new.ts', '@@ -1 +1 @@', '--- a/x', '+y', ''].join('\n');
  expect(retargetPatch(p, 'dir/n ü.ts')).toBe(
    ['diff --git "a/dir/n \\303\\274.ts" "b/dir/n \\303\\274.ts"', 'index 1..2 100644', '--- "a/dir/n \\303\\274.ts"', '+++ "b/dir/n \\303\\274.ts"', '@@ -1 +1 @@', '--- a/x', '+y', ''].join('\n'),
  );
  const added = ['diff --git a/x b/x', 'new file mode 100644', '--- /dev/null', '+++ b/x', '@@ -0,0 +1 @@', '+a', ''].join('\n');
  expect(retargetPatch(added, 'y')).toBe(['diff --git a/y b/y', 'new file mode 100644', '--- /dev/null', '+++ b/y', '@@ -0,0 +1 @@', '+a', ''].join('\n'));
  expect(retargetPatch('@@ -1 +1 @@\n', 'y')).toBeUndefined();
});
