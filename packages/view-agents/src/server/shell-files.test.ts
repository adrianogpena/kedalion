import { expect, test } from 'bun:test';
import { shellFileOps } from './shell-files.ts';

test('finds file changes in common commands and redirections', () => {
  expect(shellFileOps('rm -rf dist && mv a.txt b.txt; echo hi > out.log 2>&1', '/p')).toEqual([
    { op: 'delete', path: '/p/dist' },
    { op: 'move-from', path: '/p/a.txt' },
    { op: 'move-to', path: '/p/b.txt' },
    { op: 'write', path: '/p/out.log' },
  ]);
  expect(shellFileOps("sed -i 's/a/b/' x.ts && git checkout -- y.ts && git restore z.ts")).toEqual([
    { op: 'edit', path: 'x.ts' },
    { op: 'restore', path: 'y.ts' },
    { op: 'restore', path: 'z.ts' },
  ]);
  expect(shellFileOps('ls | grep x > /dev/null; rm *.tmp')).toEqual([]);
});
