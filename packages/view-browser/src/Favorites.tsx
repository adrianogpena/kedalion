import { useState } from 'react';
import { IconButton } from '@kedalion/ui';
import { normalizeAddress } from './address';
import { t } from './i18n';

const KEY = 'kedalion.browser.favorites';

export function isEmptyTabUrl(url: string | undefined): boolean {
  return !url || url === 'about:blank';
}

function load(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the list lasts for this session only.
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Saved links shown on an empty tab; a click opens the link in that tab. */
export function Favorites({ onOpen }: { onOpen: (url: string) => void }) {
  const [list, setList] = useState(load);
  const [draft, setDraft] = useState('');

  const update = (next: string[]) => {
    setList(next);
    save(next);
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const url = normalizeAddress(text);
    if (!list.includes(url)) update([...list, url]);
    setDraft('');
  };

  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const drop = (to: number) => {
    if (drag !== null && drag !== to) {
      const next = [...list];
      const [moved] = next.splice(drag, 1);
      next.splice(to, 0, moved!);
      update(next);
    }
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="browser-favorites">
      <h2 className="browser-favorites-title">{t('browser.favorites')}</h2>
      <div className="browser-favorites-form">
        <input
          className="browser-url"
          type="text"
          spellCheck={false}
          aria-label={t('browser.favorites.add')}
          placeholder={t('browser.favorites.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <IconButton icon="plus" label={t('browser.favorites.add')} disabled={!draft.trim()} onClick={add} />
      </div>
      {list.length === 0 && <p className="browser-favorites-empty">{t('browser.favorites.empty')}</p>}
      <ul className="browser-favorites-list">
        {list.map((url, i) => (
          <li
            key={url}
            className={`browser-favorite${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDrag(i);
            }}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(i);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            <button type="button" className="browser-favorite-link" title={url} onClick={() => onOpen(url)}>
              <span className="browser-favorite-host">{hostOf(url)}</span>
              <span className="browser-favorite-url">{url}</span>
            </button>
            <IconButton icon="close" size="xs" label={t('browser.favorites.remove')} onClick={() => update(list.filter((x) => x !== url))} />
          </li>
        ))}
      </ul>
    </div>
  );
}
