import { useCallback, useRef, useState } from 'react';
import { copyNotify, IconButton, request } from '@kedalion/ui';
import { t } from './i18n';

export type DevToolsResult = { mode: 'iframe'; url: string } | { mode: 'window' };
export type DevToolsPosition = 'right' | 'bottom';

/** Asks the server to open the DevTools of a tab; `panel` selects the frontend panel for an iframe. */
export async function openDevTools(tab: string, panel?: string): Promise<DevToolsResult> {
  const r = await request<DevToolsResult>('POST', '/api/browser/devtools', {}, { id: tab });
  if (r.mode === 'iframe' && panel) return { mode: 'iframe', url: `${r.url}&panel=${encodeURIComponent(panel)}` };
  return r;
}

export async function copyMcpConfig(): Promise<void> {
  try {
    const config = await request<unknown>('GET', '/api/browser/mcp-config');
    await copyNotify(JSON.stringify(config, null, 2));
  } catch {
    // The request layer reports the failure.
  }
}

/** A size kept in localStorage; storage errors fall back to the default. */
export function useStoredSize(key: string, fallback: number): [number, (n: number) => void] {
  const [size, setSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem(key));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (n: number) => {
      setSize(n);
      try {
        localStorage.setItem(key, String(Math.round(n)));
      } catch {
        // Not remembered.
      }
    },
    [key],
  );
  return [size, set];
}

export interface ResizerProps {
  /** `y` resizes a panel below (drag up grows it), `x` a panel to the right (drag left grows it). */
  axis: 'x' | 'y';
  size: number;
  onSize(n: number): void;
  min?: number;
  max?: number;
}

export function Resizer({ axis, size, onSize, min = 120, max = 900 }: ResizerProps) {
  const start = useRef<{ at: number; size: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div
      className={`browser-resizer ${axis}`}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={t('browser.resize')}
      aria-valuenow={Math.round(size)}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { at: axis === 'y' ? e.clientY : e.clientX, size };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) onSize(clamp(s.size - ((axis === 'y' ? e.clientY : e.clientX) - s.at)));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        const grow = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
        const shrink = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
        if (e.key === grow) onSize(clamp(size + 24));
        else if (e.key === shrink) onSize(clamp(size - 24));
        else return;
        e.preventDefault();
      }}
    />
  );
}

export interface DevToolsPaneProps {
  url: string;
  position: DevToolsPosition;
  onPosition(p: DevToolsPosition): void;
  onClose(): void;
}

/** The DevTools frontend of the active tab, docked right or bottom and resizable. */
export function DevToolsPane({ url, position, onPosition, onClose }: DevToolsPaneProps) {
  const [width, setWidth] = useStoredSize('kedalion.browser.devtoolsWidth', 480);
  const [height, setHeight] = useStoredSize('kedalion.browser.devtoolsHeight', 320);
  const right = position === 'right';
  return (
    <div className={`browser-devtools ${position}`} style={right ? { width } : { height }}>
      <Resizer axis={right ? 'x' : 'y'} size={right ? width : height} onSize={right ? setWidth : setHeight} min={right ? 240 : 160} />
      <div className="browser-devtools-bar">
        <IconButton
          icon="popout"
          size="xs"
          label={t(right ? 'browser.devtools.dockBottom' : 'browser.devtools.dockRight')}
          onClick={() => onPosition(right ? 'bottom' : 'right')}
        />
        <IconButton icon="close" size="xs" label={t('browser.devtools.close')} onClick={onClose} />
      </div>
      <iframe className="browser-devtools-frame" title={t('browser.devtools')} src={url} />
    </div>
  );
}
