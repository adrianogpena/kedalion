import type { ConsoleEntry, Emulation, NetworkEntry, TabInfo, UiInputEvent } from '@kedalion/cdp';

export const BROWSER_SOCKET_PATH = '/api/browser/socket';

export interface SelectOptionInfo {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}

export type ServerMsg =
  | { type: 'tabs'; tabs: TabInfo[]; active?: string }
  | { type: 'frame'; tab: string; data: string; w: number; h: number }
  | { type: 'console'; tab: string; entries: ConsoleEntry[] }
  | { type: 'network'; tab: string; entries: NetworkEntry[] }
  | { type: 'dialog'; tab: string; kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload'; message: string; defaultPrompt?: string }
  | { type: 'fileChooser'; tab: string; id: string; multiple: boolean }
  | { type: 'select'; tab: string; id: string; options: SelectOptionInfo[] }
  | { type: 'download'; name: string; path: string; done: boolean }
  | { type: 'emulation'; tab: string; emulation: Emulation }
  | { type: 'error'; message: string };

export type ClientMsg =
  | { type: 'viewport'; w: number; h: number; dpr: number }
  | { type: 'input'; event: UiInputEvent }
  | { type: 'activate'; tab: string }
  | { type: 'selectChoice'; id: string; value: string }
  | { type: 'dialogAnswer'; tab: string; accept: boolean; text?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || str(v);

function validMods(m: unknown): boolean {
  return m === undefined || (isObj(m) && ['alt', 'ctrl', 'meta', 'shift'].every((k) => typeof m[k] === 'boolean'));
}

function validInput(e: unknown): e is UiInputEvent {
  if (!isObj(e)) return false;
  switch (e.type) {
    case 'mouse':
      return (
        (e.action === 'move' || e.action === 'down' || e.action === 'up') &&
        num(e.x) &&
        num(e.y) &&
        (e.button === undefined || e.button === 'none' || e.button === 'left' || e.button === 'middle' || e.button === 'right') &&
        (e.clickCount === undefined || num(e.clickCount)) &&
        validMods(e.modifiers)
      );
    case 'wheel':
      return num(e.x) && num(e.y) && num(e.deltaX) && num(e.deltaY) && validMods(e.modifiers);
    case 'key':
      return (e.action === 'down' || e.action === 'up') && str(e.key) && optStr(e.code) && validMods(e.modifiers) && (e.repeat === undefined || typeof e.repeat === 'boolean');
    case 'text':
      return str(e.text);
    default:
      return false;
  }
}

/** The message a socket client sent, or null when it is not valid JSON of a known, well-formed shape. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'viewport':
      return num(v.w) && num(v.h) && num(v.dpr) && v.w > 0 && v.h > 0 && v.dpr > 0 ? { type: 'viewport', w: v.w, h: v.h, dpr: v.dpr } : null;
    case 'input':
      return validInput(v.event) ? { type: 'input', event: v.event } : null;
    case 'activate':
      return str(v.tab) && v.tab ? { type: 'activate', tab: v.tab } : null;
    case 'selectChoice':
      return str(v.id) && str(v.value) ? { type: 'selectChoice', id: v.id, value: v.value } : null;
    case 'dialogAnswer':
      return str(v.tab) && typeof v.accept === 'boolean' && optStr(v.text)
        ? { type: 'dialogAnswer', tab: v.tab, accept: v.accept, ...(v.text !== undefined ? { text: v.text as string } : {}) }
        : null;
    default:
      return null;
  }
}
