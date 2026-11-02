import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, copyNotify, IconButton } from '@kedalion/ui';
import { browserApi, type BrowserCookie, type CookieScope } from './client';
import { t } from './i18n';

const keyOf = (c: Pick<BrowserCookie, 'domain' | 'path' | 'name'>) => `${c.domain}\t${c.path}\t${c.name}`;

export function formatExpires(expires: number | undefined): string {
  return expires === undefined ? t('browser.cookies.session') : new Date(expires * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** Unix seconds of a UTC date text ("2030-01-31 12:00:00" or ISO); undefined for empty (session), null when invalid. */
export function parseExpires(text: string): number | undefined | null {
  const s = text.trim();
  if (!s || s.toLowerCase() === 'session') return undefined;
  const ms = Date.parse(/z$|[+-]\d\d:?\d\d$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

interface Draft {
  isNew: boolean;
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: '' | 'Strict' | 'Lax' | 'None';
}

const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
};

const fromCookie = (c: BrowserCookie): Draft => ({
  isNew: false,
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  expires: c.expires === undefined ? '' : formatExpires(c.expires),
  httpOnly: c.httpOnly,
  secure: c.secure,
  sameSite: c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None' ? c.sameSite : '',
});

export interface CookiesPaneProps {
  tab: string;
  /** The page URL; the list reloads when it changes. */
  url: string | undefined;
}

/** Cookies of the active page or of the whole profile, with add, edit, delete and clear. */
export function CookiesPane({ tab, url }: CookiesPaneProps) {
  const [scope, setScope] = useState<CookieScope>('page');
  const [filter, setFilter] = useState('');
  const [cookies, setCookies] = useState<BrowserCookie[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [invalidExpires, setInvalidExpires] = useState(false);

  const load = useCallback(async () => {
    try {
      setCookies((await browserApi.cookies(tab, scope)).cookies);
    } catch {
      setCookies([]);
    }
  }, [tab, scope]);

  useEffect(() => {
    void load();
  }, [load, url]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return cookies.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.domain.toLowerCase().includes(needle));
  }, [cookies, filter]);

  const select = (c: BrowserCookie) => {
    setSelected(keyOf(c));
    setDraft(fromCookie(c));
    setInvalidExpires(false);
  };
  const startNew = () => {
    setSelected(null);
    setInvalidExpires(false);
    setDraft({ isNew: true, name: '', value: '', domain: hostOf(url), path: '/', expires: '', httpOnly: false, secure: false, sameSite: '' });
  };
  const closeDraft = () => {
    setDraft(null);
    setSelected(null);
  };

  const remove = async (c: BrowserCookie) => {
    try {
      await browserApi.deleteCookie(tab, c);
    } catch {
      // The request layer reports the failure.
    }
    if (keyOf(c) === selected) closeDraft();
    await load();
  };
  const clear = async () => {
    try {
      await browserApi.clearCookies(tab, scope);
    } catch {
      // The request layer reports the failure.
    }
    closeDraft();
    await load();
  };
  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    const expires = parseExpires(draft.expires);
    if (expires === null) {
      setInvalidExpires(true);
      return;
    }
    try {
      await browserApi.setCookie(tab, {
        name: draft.name.trim(),
        value: draft.value,
        ...(draft.domain.trim() ? { domain: draft.domain.trim() } : {}),
        path: draft.path.trim() || '/',
        ...(expires !== undefined ? { expires } : {}),
        httpOnly: draft.httpOnly,
        secure: draft.secure,
        ...(draft.sameSite ? { sameSite: draft.sameSite } : {}),
      });
    } catch {
      return;
    }
    setSelected(keyOf({ name: draft.name.trim(), domain: draft.domain.trim(), path: draft.path.trim() || '/' }));
    setDraft({ ...draft, isNew: false });
    await load();
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <IconButton icon="refresh" size="sm" label={t('browser.cookies.refresh')} onClick={() => void load()} />
        <IconButton icon="plus" size="sm" label={t('browser.cookies.add')} onClick={startNew} />
        <IconButton icon="trash" size="sm" label={t(scope === 'page' ? 'browser.cookies.clearPage' : 'browser.cookies.clearAll')} disabled={cookies.length === 0} onClick={() => void clear()} />
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.logs.filter')} placeholder={t('browser.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="browser-chips" role="group" aria-label={t('browser.cookies.scope')}>
          <Button size="xs" pressed={scope === 'page'} onClick={() => setScope('page')}>{t('browser.cookies.scope.page')}</Button>
          <Button size="xs" pressed={scope === 'all'} onClick={() => setScope('all')}>{t('browser.cookies.scope.all')}</Button>
        </div>
      </div>
      <div className="browser-net">
        <div className="net-table-wrap">
          {rows.length === 0 ? (
            <div className="browser-pane-empty">{t('browser.cookies.empty')}</div>
          ) : (
            <table className="net-table">
              <thead>
                <tr>
                  <th>{t('browser.cookies.col.name')}</th>
                  <th>{t('browser.cookies.col.value')}</th>
                  <th>{t('browser.cookies.col.domain')}</th>
                  <th>{t('browser.cookies.col.path')}</th>
                  <th>{t('browser.cookies.col.expires')}</th>
                  <th>{t('browser.cookies.col.flags')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const k = keyOf(c);
                  return (
                    <tr
                      key={k}
                      tabIndex={0}
                      aria-selected={k === selected}
                      className={`net-row${k === selected ? ' selected' : ''}`}
                      onClick={() => select(c)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          select(c);
                        }
                      }}
                    >
                      <td className="net-name" title={c.name}>{c.name}</td>
                      <td className="cookie-value" title={c.value}>{c.value}</td>
                      <td>{c.domain}</td>
                      <td>{c.path}</td>
                      <td>{formatExpires(c.expires)}</td>
                      <td>{[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite].filter(Boolean).join(' ')}</td>
                      <td>
                        <IconButton
                          icon="trash"
                          size="xs"
                          label={t('browser.cookies.delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(c);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {draft && (
          <div className="cookie-detail">
            <div className="cookie-detail-bar">
              <strong>{draft.isNew ? t('browser.cookies.new') : draft.name}</strong>
              <span className="cookie-detail-actions">
                <IconButton icon="copy" size="xs" label={t('browser.cookies.copyValue')} onClick={() => void copyNotify(draft.value)} />
                <IconButton icon="close" size="xs" label={t('browser.cookies.closeDetail')} onClick={closeDraft} />
              </span>
            </div>
            <div className="cookie-form">
              <label>{t('browser.cookies.col.name')}<input type="text" spellCheck={false} disabled={!draft.isNew} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label>{t('browser.cookies.col.value')}<textarea spellCheck={false} rows={3} value={draft.value} onChange={(e) => set({ value: e.target.value })} /></label>
              <label>{t('browser.cookies.col.domain')}<input type="text" spellCheck={false} disabled={!draft.isNew} value={draft.domain} onChange={(e) => set({ domain: e.target.value })} /></label>
              <label>{t('browser.cookies.col.path')}<input type="text" spellCheck={false} disabled={!draft.isNew} value={draft.path} onChange={(e) => set({ path: e.target.value })} /></label>
              <label>
                {t('browser.cookies.col.expires')}
                <input type="text" spellCheck={false} placeholder={t('browser.cookies.expiresHint')} aria-invalid={invalidExpires} value={draft.expires} onChange={(e) => { setInvalidExpires(false); set({ expires: e.target.value }); }} />
              </label>
              <label>
                SameSite
                <select value={draft.sameSite} onChange={(e) => set({ sameSite: e.target.value as Draft['sameSite'] })}>
                  <option value="">—</option>
                  <option value="Strict">Strict</option>
                  <option value="Lax">Lax</option>
                  <option value="None">None</option>
                </select>
              </label>
              <label className="cookie-check"><input type="checkbox" checked={draft.httpOnly} onChange={(e) => set({ httpOnly: e.target.checked })} />HttpOnly</label>
              <label className="cookie-check"><input type="checkbox" checked={draft.secure} onChange={(e) => set({ secure: e.target.checked })} />Secure</label>
              <Button size="sm" variant="primary" disabled={!draft.name.trim()} onClick={() => void save()}>{t('browser.save')}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
