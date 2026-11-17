import { describe, expect, test } from 'bun:test';
import { conflictMessage, effectiveKeys, normalizeChord, normalizeChordReason, type CommandDef } from '../src/keybindings.ts';

describe('aliases', () => {
  test('minus and hyphen', () => {
    expect(normalizeChord('Ctrl+Minus')).toBe('Ctrl+-');
    expect(normalizeChord('alt+hyphen')).toBe('Alt+-');
  });
});

describe('normalizeChordReason', () => {
  test('ok matches normalizeChord', () => {
    expect(normalizeChordReason('ctrl+k ctrl+c')).toEqual({ chord: 'Ctrl+K Ctrl+C' });
  });
  test('reasons', () => {
    expect(normalizeChordReason('Ctrl+Foo')).toEqual({ error: 'unknown key "Foo"' });
    expect(normalizeChordReason('Ctrl+A+B')).toHaveProperty('error');
    expect(normalizeChordReason('Ctrl+')).toHaveProperty('error');
    expect(normalizeChordReason('A B C D')).toHaveProperty('error');
    expect(normalizeChordReason('Ctrl')).toHaveProperty('error');
    expect(normalizeChord('Ctrl+Foo')).toBeNull();
  });
});

describe('effectiveKeys memo', () => {
  const defs: CommandDef[] = [{ id: 'a', scope: 'global', label: 'A', keys: ['Ctrl+A'] }];
  test('same inputs give the same map, new keymap a new one', () => {
    const km = {};
    expect(effectiveKeys(defs, km)).toBe(effectiveKeys(defs, km));
    expect(effectiveKeys(defs, {})).not.toBe(effectiveKeys(defs, km));
    expect(effectiveKeys(defs, { a: [] }).get('a')).toEqual([]);
  });
});

describe('conflictMessage', () => {
  test('names key and ids', () => {
    expect(conflictMessage({ chord: 'Ctrl+A', ids: ['x.one', 'y.two'] })).toBe('Ctrl+A is bound to x.one and y.two');
  });
});
