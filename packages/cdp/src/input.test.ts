import { expect, test } from 'bun:test';
import { createFakeClient } from './fake.ts';
import { keyCode, mapInput, modifierMask } from './input.ts';
import { startScreencast } from './screencast.ts';

test('modifier bitmask is Alt=1 Ctrl=2 Meta=4 Shift=8', () => {
  expect(modifierMask({})).toBe(0);
  expect(modifierMask({ alt: true })).toBe(1);
  expect(modifierMask({ ctrl: true, shift: true })).toBe(10);
  expect(modifierMask({ alt: true, ctrl: true, meta: true, shift: true })).toBe(15);
});

test('key codes for named, function and printable keys', () => {
  expect(keyCode('Enter')).toBe(13);
  expect(keyCode('Tab')).toBe(9);
  expect(keyCode('Backspace')).toBe(8);
  expect(keyCode('Escape')).toBe(27);
  expect([keyCode('ArrowLeft'), keyCode('ArrowUp'), keyCode('ArrowRight'), keyCode('ArrowDown')]).toEqual([37, 38, 39, 40]);
  expect([keyCode('Delete'), keyCode('Home'), keyCode('End'), keyCode('PageUp'), keyCode('PageDown')]).toEqual([46, 36, 35, 33, 34]);
  expect(keyCode('F1')).toBe(112);
  expect(keyCode('F12')).toBe(123);
  expect(keyCode('a')).toBe(65);
  expect(keyCode('7')).toBe(55);
  expect(keyCode('Unidentified')).toBe(0);
});

test('mouse events map type, buttons, clickCount and modifiers', () => {
  expect(mapInput({ type: 'mouse', action: 'down', x: 5, y: 6, button: 'left', clickCount: 2, modifiers: { shift: true } })).toEqual([
    { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 5, y: 6, button: 'left', buttons: 1, clickCount: 2, modifiers: 8 } },
  ]);
  expect(mapInput({ type: 'mouse', action: 'up', x: 5, y: 6, button: 'right' })[0]!.params).toMatchObject({ type: 'mouseReleased', buttons: 0, button: 'right', clickCount: 1 });
  expect(mapInput({ type: 'mouse', action: 'move', x: 1, y: 2 })[0]!.params).toMatchObject({ type: 'mouseMoved', button: 'none', clickCount: 0 });
});

test('wheel maps deltas', () => {
  expect(mapInput({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 120, modifiers: { ctrl: true } })[0]!.params).toMatchObject({ type: 'mouseWheel', deltaX: 0, deltaY: 120, modifiers: 2 });
});

test('printable keys send text, named keys and shortcuts are raw', () => {
  expect(mapInput({ type: 'key', action: 'down', key: 'a' })[0]!.params).toMatchObject({ type: 'keyDown', text: 'a', windowsVirtualKeyCode: 65 });
  expect(mapInput({ type: 'key', action: 'down', key: 'Enter' })[0]!.params).toMatchObject({ type: 'keyDown', text: '\r', windowsVirtualKeyCode: 13 });
  expect(mapInput({ type: 'key', action: 'down', key: 'ArrowLeft' })[0]!.params).toMatchObject({ type: 'rawKeyDown', windowsVirtualKeyCode: 37 });
  const copy = mapInput({ type: 'key', action: 'down', key: 'c', modifiers: { ctrl: true } })[0]!.params;
  expect(copy).toMatchObject({ type: 'rawKeyDown', modifiers: 2 });
  expect('text' in copy).toBe(false);
  expect(mapInput({ type: 'key', action: 'up', key: 'a' })[0]!.params).toMatchObject({ type: 'keyUp', windowsVirtualKeyCode: 65 });
});

test('text maps to insertText', () => {
  expect(mapInput({ type: 'text', text: 'olá' })).toEqual([{ method: 'Input.insertText', params: { text: 'olá' } }]);
});

test('screencast sizes the viewport, acks frames and stops', () => {
  const client = createFakeClient();
  const frames: string[] = [];
  const stop = startScreencast(client.session('s'), { width: 800, height: 600, dpr: 2 }, (data) => frames.push(data));
  expect(client.calls[0]).toMatchObject({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 800, height: 600, deviceScaleFactor: 2 } });
  expect(client.calls[1]).toMatchObject({ method: 'Page.startScreencast', params: { format: 'jpeg', maxWidth: 1600, maxHeight: 1200 } });
  client.emit('Page.screencastFrame', { data: 'abc', sessionId: 7, metadata: {} }, 's');
  expect(frames).toEqual(['abc']);
  expect(client.calls.at(-1)).toMatchObject({ method: 'Page.screencastFrameAck', params: { sessionId: 7 } });
  stop();
  client.emit('Page.screencastFrame', { data: 'def', sessionId: 8, metadata: {} }, 's');
  expect(frames).toEqual(['abc']);
  expect(client.calls.at(-1)!.method).toBe('Page.stopScreencast');
});
