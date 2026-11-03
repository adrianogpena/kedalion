import { useSyncExternalStore, type ReactNode } from 'react';
import { useLayout } from '../layout';

export interface StatusItem {
  id: string;
  text: ReactNode;
  /** Tooltip; also the accessible name of a clickable item. */
  title?: string;
  onClick?: () => void;
  /** Default right, like VS Code's editor items. */
  align?: 'left' | 'right';
}

/** A thin row of status items; clickable ones are buttons. Items keep their order within each side. */
export function StatusBar(props: StatusBarProps) {
  const { StatusBar: Shell } = useLayout().navParts;
  return <Shell {...props} />;
}

export interface StatusBarProps {
  items: StatusItem[];
}

export function BaseStatusBar({ items }: StatusBarProps) {
  const { structure } = useLayout();
  if (!structure.statusBar) return null;
  const render = (item: StatusItem) =>
    item.onClick ? (
      <button key={item.id} type="button" className="status-item status-action" title={item.title} onClick={item.onClick}>
        {item.text}
      </button>
    ) : (
      <span key={item.id} className="status-item" title={item.title}>
        {item.text}
      </span>
    );
  return (
    <div className="status-bar" role="status">
      {items.filter((i) => i.align === 'left').map(render)}
      <span className="spacer" />
      {items.filter((i) => i.align !== 'left').map(render)}
    </div>
  );
}

/** Islands: the same items, on the frame (transparent, no strip). */
export function IslandsStatusBar(props: StatusBarProps) {
  const { structure } = useLayout();
  if (!structure.statusBar) return null;
  return (
    <div className="islands-status">
      <BaseStatusBar {...props} />
    </div>
  );
}

/** Label of the current screen, as the Sidebar writes it on <html data-screen-label>. */
function subscribeScreenLabel(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-screen-label'] });
  return () => observer.disconnect();
}
const screenLabel = () => document.documentElement.dataset.screenLabel ?? '';

/** Modeline: a vim-style line; the current screen leads as the mode block, items follow as segments. */
export function ModelineStatusBar(props: StatusBarProps) {
  const mode = useSyncExternalStore(subscribeScreenLabel, screenLabel, () => '');
  const { structure } = useLayout();
  if (!structure.statusBar) return null;
  return (
    <div className="modeline">
      {mode && <span className="modeline-mode">{mode}</span>}
      <BaseStatusBar {...props} />
    </div>
  );
}

/** `512 B`, `1.4 KB`, `12 MB`: sizes the way a status bar shows them (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
