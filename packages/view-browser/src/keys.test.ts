import { expect, test } from 'bun:test';
import { appKeyAction, type KeyLike } from './keys';

const k = (key: string, m: Partial<KeyLike> = {}): KeyLike => ({ key, ctrl: false, alt: false, shift: false, meta: false, ...m });

test('the app chords map to actions', () => {
  expect(appKeyAction(k('l', { ctrl: true }))).toBe('focusUrl');
  expect(appKeyAction(k('L', { ctrl: true }))).toBe('focusUrl');
  expect(appKeyAction(k('t', { ctrl: true }))).toBe('newTab');
  expect(appKeyAction(k('w', { ctrl: true }))).toBe('closeTab');
  expect(appKeyAction(k('Tab', { ctrl: true }))).toBe('nextTab');
  expect(appKeyAction(k('Tab', { ctrl: true, shift: true }))).toBe('prevTab');
  expect(appKeyAction(k('F5'))).toBe('reload');
  expect(appKeyAction(k('r', { ctrl: true }))).toBe('reload');
  expect(appKeyAction(k('F12'))).toBe('devtools');
  expect(appKeyAction(k('ArrowLeft', { alt: true }))).toBe('back');
  expect(appKeyAction(k('ArrowRight', { alt: true }))).toBe('forward');
  expect(appKeyAction(k('P', { ctrl: true, shift: true }))).toBe('palette');
  expect(appKeyAction(k('F1'))).toBe('palette');
});

test('every other key goes to the page', () => {
  expect(appKeyAction(k('a'))).toBeNull();
  expect(appKeyAction(k('a', { ctrl: true }))).toBeNull();
  expect(appKeyAction(k('v', { ctrl: true }))).toBeNull();
  expect(appKeyAction(k('ArrowLeft'))).toBeNull();
  expect(appKeyAction(k('F5', { shift: true }))).toBeNull();
  expect(appKeyAction(k('l', { ctrl: true, alt: true }))).toBeNull();
});
