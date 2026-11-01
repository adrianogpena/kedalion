import type { ReactNode } from 'react';
import './design-shell.css';
import { Button } from './components/Button';
import { BrandMark } from './components/ui';
import type { IconName } from './icons';

/** Design preview, shell variants. Placeholder controls have no handlers; only the search and chips work. */

export interface CommandBarItem { id: string; label: string; icon: IconName }

/** Variant A: slim top bar with the logo, a palette field and the view switcher chips. */
export function CommandBar({ name, items, current, onSelect, onSearch, tools }: {
  name: string; items: CommandBarItem[]; current: string; onSelect: (id: string) => void; onSearch: () => void; tools?: ReactNode;
}) {
  return (
    <header className="design-cmdbar">
      <div className="design-cmdbar-brand"><BrandMark size={20} /><span>{name}</span></div>
      <Button size="sm" icon="search" className="design-cmdbar-field" onClick={onSearch}>
        <span className="design-cmdbar-hint">Search or run a command…</span>
        <kbd className="design-cmdbar-kbd">Ctrl K</kbd>
      </Button>
      <nav className="design-cmdbar-chips" aria-label="Views">
        {items.map((i) => (
          <Button key={i.id} size="xs" variant="ghost" icon={i.icon} pressed={i.id === current} onClick={() => onSelect(i.id)}>{i.label}</Button>
        ))}
      </nav>
      <div className="design-cmdbar-tools">{tools}</div>
    </header>
  );
}

/** Variant A: bottom activity strip in place of the status bar (placeholder facts). */
export function ActivityStrip() {
  return (
    <footer className="design-strip">
      <span>git: 2 ahead</span><span>·</span><span>tsc ok</span><span>·</span><span>timesheet 5h12</span><span>·</span><span>rate 6.31</span>
      <span className="design-strip-spacer" />
      <span>3 jobs</span>
    </footer>
  );
}

