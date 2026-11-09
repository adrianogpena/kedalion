import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingPaths, validExistsBody, windowsPathOf } from './sidebar-exists.ts';

describe('windowsPathOf', () => {
  test('maps drive forms', () => {
    expect(windowsPathOf('c:/a/b')).toBe('C:\\a\\b');
    expect(windowsPathOf('/mnt/d/x')).toBe('D:\\x');
    expect(windowsPathOf('/e/y/')).toBe('E:\\y');
    expect(windowsPathOf('X:\\')).toBe('X:\\');
  });
  test('ignores other paths', () => {
    expect(windowsPathOf('~')).toBeNull();
    expect(windowsPathOf('/home/me')).toBeNull();
  });
});

describe('missingPaths', () => {
  test('uses the mapped path and skips non drive paths', () => {
    const seen: string[] = [];
    const stat = (p: string) => {
      seen.push(p);
      if (p.startsWith('D:')) throw new Error('nope');
      return { isDirectory: () => p !== 'E:\\file' };
    };
    expect(missingPaths(['C:\\ok', '/mnt/d/gone', '/e/file', '~', '/home/x'], stat)).toEqual(['/mnt/d/gone', '/e/file']);
    expect(seen).toEqual(['C:\\ok', 'D:\\gone', 'E:\\file']);
  });
  test('real folders and files', () => {
    if (process.platform !== 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'exists-'));
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'x');
    expect(missingPaths([dir, file, join(dir, 'none')])).toEqual([file, join(dir, 'none')]);
  });
});

describe('validExistsBody', () => {
  test('checks shape and size', () => {
    expect(validExistsBody({ paths: ['a'] })).toEqual(['a']);
    expect(validExistsBody({ paths: [1] })).toBeNull();
    expect(validExistsBody({ paths: Array(201).fill('a') })).toBeNull();
    expect(validExistsBody(null)).toBeNull();
  });
});
