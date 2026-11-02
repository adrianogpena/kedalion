import { expect, test } from 'bun:test';
import { parseClientMsg } from './protocol.ts';

const p = (v: unknown) => parseClientMsg(JSON.stringify(v));

test('parses valid messages', () => {
  expect(p({ type: 'viewport', w: 800, h: 600, dpr: 2 })).toEqual({ type: 'viewport', w: 800, h: 600, dpr: 2 });
  expect(p({ type: 'input', event: { type: 'mouse', action: 'down', x: 1, y: 2, button: 'left' } })).not.toBeNull();
  expect(p({ type: 'input', event: { type: 'key', action: 'down', key: 'a' } })).not.toBeNull();
  expect(p({ type: 'input', event: { type: 'text', text: 'hi' } })).not.toBeNull();
  expect(p({ type: 'activate', tab: 't1' })).toEqual({ type: 'activate', tab: 't1' });
  expect(p({ type: 'selectChoice', id: '1', value: 'x' })).toEqual({ type: 'selectChoice', id: '1', value: 'x' });
  expect(p({ type: 'dialogAnswer', tab: 't', accept: true, text: 'a' })).toEqual({ type: 'dialogAnswer', tab: 't', accept: true, text: 'a' });
});

test('rejects malformed messages', () => {
  expect(parseClientMsg('nope')).toBeNull();
  expect(parseClientMsg('[]')).toBeNull();
  expect(p({ type: 'unknown' })).toBeNull();
  expect(p({ type: 'viewport', w: 0, h: 1, dpr: 1 })).toBeNull();
  expect(p({ type: 'viewport', w: 'a', h: 1, dpr: 1 })).toBeNull();
  expect(p({ type: 'input', event: { type: 'mouse', action: 'jump', x: 1, y: 2 } })).toBeNull();
  expect(p({ type: 'input', event: { type: 'wheel', x: 1, y: 2 } })).toBeNull();
  expect(p({ type: 'activate', tab: '' })).toBeNull();
  expect(p({ type: 'dialogAnswer', tab: 't', accept: 'yes' })).toBeNull();
});
