import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSidebarStore } from './sidebar-store.ts';
import { emptySidebar } from './sidebar-types.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'sidebar-'));

describe('sidebar store', () => {
  test('round trip', () => {
    const store = createSidebarStore(join(dir(), 'terminal', 'sidebar.json'));
    const d = { paths: [{ id: 'a', name: 'n', path: '/p' }], commands: [{ id: 'b', name: '', command: 'ls' }] };
    expect(store.write(d)).toBe(true);
    expect(store.read()).toEqual(d);
  });
  test('missing and corrupt files read as empty', () => {
    const d = dir();
    expect(createSidebarStore(join(d, 'none.json')).read()).toEqual(emptySidebar());
    writeFileSync(join(d, 'bad.json'), '{oops');
    expect(createSidebarStore(join(d, 'bad.json')).read()).toEqual(emptySidebar());
  });
  test('invalid write returns false', () => {
    const store = createSidebarStore(join(dir(), 's.json'));
    expect(store.write({ paths: [{ id: '', name: '', path: 'x' }], commands: [] })).toBe(false);
  });
});
