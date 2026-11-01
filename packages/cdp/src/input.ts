export interface Modifiers {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type MouseButton = 'none' | 'left' | 'middle' | 'right';

export type UiInputEvent =
  | { type: 'mouse'; action: 'move' | 'down' | 'up'; x: number; y: number; button?: MouseButton; clickCount?: number; modifiers?: Modifiers }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: Modifiers }
  | { type: 'key'; action: 'down' | 'up'; key: string; code?: string; modifiers?: Modifiers; repeat?: boolean }
  | { type: 'text'; text: string };

export interface CdpCall {
  method: string;
  params: Record<string, unknown>;
}

/** Alt=1 Ctrl=2 Meta=4 Shift=8. */
export function modifierMask(m: Modifiers = {}): number {
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

const BUTTON_BITS: Record<MouseButton, number> = { none: 0, left: 1, right: 2, middle: 4 };

const NAMED_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ' ': 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

export function keyCode(key: string): number {
  const named = NAMED_KEYS[key];
  if (named !== undefined) return named;
  const f = /^F(\d{1,2})$/.exec(key);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 12) return 111 + Number(f[1]);
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

export function mapInput(ev: UiInputEvent): CdpCall[] {
  switch (ev.type) {
    case 'mouse': {
      const button = ev.button ?? 'none';
      const type = ev.action === 'move' ? 'mouseMoved' : ev.action === 'down' ? 'mousePressed' : 'mouseReleased';
      const pressed = ev.action === 'up' ? 0 : BUTTON_BITS[button];
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: {
            type,
            x: ev.x,
            y: ev.y,
            button: ev.action === 'move' && pressed === 0 ? 'none' : button,
            buttons: pressed,
            clickCount: ev.action === 'move' ? 0 : (ev.clickCount ?? 1),
            modifiers: modifierMask(ev.modifiers),
          },
        },
      ];
    }
    case 'wheel':
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseWheel', x: ev.x, y: ev.y, deltaX: ev.deltaX, deltaY: ev.deltaY, button: 'none', buttons: 0, modifiers: modifierMask(ev.modifiers) },
        },
      ];
    case 'key': {
      const modifiers = modifierMask(ev.modifiers);
      const base = { key: ev.key, ...(ev.code ? { code: ev.code } : {}), windowsVirtualKeyCode: keyCode(ev.key), modifiers };
      if (ev.action === 'up') return [{ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...base } }];
      const shortcut = !!(ev.modifiers?.ctrl || ev.modifiers?.alt || ev.modifiers?.meta);
      const text = ev.key === 'Enter' ? '\r' : ev.key.length === 1 && !shortcut ? ev.key : undefined;
      return [
        {
          method: 'Input.dispatchKeyEvent',
          params: { type: text === undefined ? 'rawKeyDown' : 'keyDown', ...base, ...(text === undefined ? {} : { text, unmodifiedText: text }), ...(ev.repeat ? { autoRepeat: true } : {}) },
        },
      ];
    }
    case 'text':
      return [{ method: 'Input.insertText', params: { text: ev.text } }];
  }
}
