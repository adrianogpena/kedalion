export type BrowserKeyAction = 'focusUrl' | 'newTab' | 'closeTab' | 'nextTab' | 'prevTab' | 'reload' | 'devtools' | 'back' | 'forward' | 'palette';

export interface KeyLike {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** The chords the app keeps instead of sending them to the page (spec § 4); every other key goes to the page. */
export function appKeyAction(e: KeyLike): BrowserKeyAction | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrl && !e.alt && !e.meta) {
    if (key === 'Tab') return e.shift ? 'prevTab' : 'nextTab';
    if (!e.shift) {
      if (key === 'l') return 'focusUrl';
      if (key === 't') return 'newTab';
      if (key === 'w') return 'closeTab';
      if (key === 'r') return 'reload';
    } else if (key === 'p') return 'palette';
  }
  if (!e.ctrl && !e.alt && !e.meta && !e.shift) {
    if (key === 'F5') return 'reload';
    if (key === 'F12') return 'devtools';
    if (key === 'F1') return 'palette';
  }
  if (e.alt && !e.ctrl && !e.meta && !e.shift) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
  }
  return null;
}
