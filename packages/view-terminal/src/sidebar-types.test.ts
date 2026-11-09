import { describe, expect, test } from 'bun:test';
import { SIDEBAR_MAX_TEXT, validSidebar } from './sidebar-types.ts';

const ok = {
  paths: [{ id: 'a', name: 'Home', path: 'C:/x', group: 'g' }],
  commands: [{ id: 'c1', name: '', command: 'ls' }],
};

describe('validSidebar', () => {
  test('accepts valid data', () => {
    expect(validSidebar(ok)).toEqual(ok);
  });
  test('rejects duplicate ids in a list', () => {
    expect(validSidebar({ ...ok, paths: [ok.paths[0], ok.paths[0]] })).toBeNull();
  });
  test('rejects oversize text', () => {
    const long = 'x'.repeat(SIDEBAR_MAX_TEXT + 1);
    expect(validSidebar({ ...ok, commands: [{ id: 'c', name: '', command: long }] })).toBeNull();
  });
  test('rejects non-string fields and bad shapes', () => {
    expect(validSidebar({ ...ok, paths: [{ id: 'a', name: 1, path: 'p' }] })).toBeNull();
    expect(validSidebar({ paths: [] })).toBeNull();
    expect(validSidebar(null)).toBeNull();
    expect(validSidebar({ ...ok, commands: [{ id: 'c', name: '', command: '' }] })).toBeNull();
  });
  test('drops unknown keys', () => {
    const r = validSidebar({ ...ok, extra: 1, paths: [{ ...ok.paths[0], zz: 1 }] });
    expect(r).toEqual(ok);
  });
});
