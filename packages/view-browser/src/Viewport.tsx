import { type MutableRefObject, useEffect, useRef } from 'react';
import type { UiInputEvent } from '@kedalion/cdp';
import { appKeyAction } from './keys';
import { t } from './i18n';
import type { BrowserSocket } from './web/useBrowserSocket';

type Mods = { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): Mods => ({ alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
const BUTTONS = ['left', 'middle', 'right'] as const;

function decode(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

export interface ViewportProps {
  socket: BrowserSocket;
  /** The active tab; frames of other tabs are ignored. */
  tab: string;
  loading: boolean;
  /** Client coordinates of the last left mouse release, where a select popup opens. */
  pointer: MutableRefObject<{ x: number; y: number }>;
  /** CSS size of an emulated device; the page is then drawn at that size, centered and scrollable. */
  device?: { w: number; h: number };
}

/** The page: a canvas painted from the screencast frames, with mouse, wheel, keyboard, IME and paste sent back as input events. */
export function Viewport({ socket, tab, loading, pointer, device }: ViewportProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ime = useRef<HTMLTextAreaElement>(null);
  const { send, subscribe, status } = socket;
  const sendRef = useRef(send);
  sendRef.current = send;
  const input = (event: UiInputEvent) => sendRef.current({ type: 'input', event });

  useEffect(() => {
    const el = box.current;
    if (!el || status !== 'open') return;
    const report = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) sendRef.current({ type: 'viewport', w, h, dpr: window.devicePixelRatio || 1 });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  useEffect(() => {
    let latest = 0;
    return subscribe((msg) => {
      if (msg.type !== 'frame' || msg.tab !== tab) return;
      const seq = ++latest;
      void createImageBitmap(decode(msg.data)).then((bmp) => {
        const c = canvas.current;
        if (seq !== latest || !c) return bmp.close();
        if (c.width !== bmp.width || c.height !== bmp.height) {
          c.width = bmp.width;
          c.height = bmp.height;
        }
        c.getContext('2d')?.drawImage(bmp, 0, 0);
        bmp.close();
      }, () => {});
    });
  }, [subscribe, tab]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      sendRef.current({ type: 'input', event: { type: 'wheel', x: e.clientX - r.left, y: e.clientY - r.top, deltaX: e.deltaX * k, deltaY: e.deltaY * k, modifiers: mods(e) } });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const move = useRef<{ ev: UiInputEvent; frame: number } | null>(null);
  useEffect(() => () => {
    if (move.current) cancelAnimationFrame(move.current.frame);
  }, []);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMouse = (action: 'down' | 'up', e: React.MouseEvent) => {
    if (action === 'down') {
      e.preventDefault();
      ime.current?.focus();
    } else pointer.current = { x: e.clientX, y: e.clientY };
    input({ type: 'mouse', action, ...point(e), button: BUTTONS[e.button] ?? 'none', clickCount: Math.max(1, e.detail), modifiers: mods(e) });
  };

  const onMove = (e: React.MouseEvent) => {
    const ev: UiInputEvent = { type: 'mouse', action: 'move', ...point(e), button: 'none', modifiers: mods(e) };
    if (move.current) {
      move.current.ev = ev;
      return;
    }
    const slot = { ev, frame: 0 };
    slot.frame = requestAnimationFrame(() => {
      move.current = null;
      input(slot.ev);
    });
    move.current = slot;
  };

  const onKey = (action: 'down' | 'up', e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.key === 'Dead') return;
    if (appKeyAction({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })) return;
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') return;
    e.preventDefault();
    input({ type: 'key', action, key: e.key, code: e.code, modifiers: mods(e), repeat: e.repeat });
  };

  const sendText = (text: string) => {
    if (text) input({ type: 'text', text });
  };

  return (
    <div ref={box} className={`browser-viewport${device ? ' device' : ''}`} role="group" aria-label={t('browser.viewport')}>
      {loading && <div className="browser-progress" role="progressbar" aria-label={t('browser.reload')} />}
      <canvas
        ref={canvas}
        className="browser-canvas"
        style={device ? { position: 'relative', inset: 'auto', width: device.w, height: device.h, margin: '0 auto' } : undefined}
        onMouseDown={(e) => onMouse('down', e)}
        onMouseUp={(e) => onMouse('up', e)}
        onMouseMove={onMove}
        onContextMenu={(e) => e.preventDefault()}
      />
      <textarea
        ref={ime}
        className="browser-ime"
        aria-label={t('browser.viewport')}
        value=""
        onChange={() => {}}
        onKeyDown={(e) => onKey('down', e)}
        onKeyUp={(e) => onKey('up', e)}
        onCompositionEnd={(e) => {
          sendText(e.data);
          e.currentTarget.value = '';
        }}
        onPaste={(e) => {
          e.preventDefault();
          sendText(e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}
