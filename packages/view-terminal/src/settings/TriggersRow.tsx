import { useEffect, useState } from 'react';
import type { TerminalTrigger } from '@kedalion/terminal';
import { Button, deepEqual, SettingItem } from '@kedalion/ui';
import { t } from '../i18n';
import type { TerminalViewSettings } from '../settings';

const MAX_TRIGGERS = 50;
const MAX_PATTERN = 500;
const DEFAULT_COLOR = '#c9a227';
const ACTIONS = ['highlight', 'capture', 'notify'] as const;

const patternError = (pattern: string): boolean => {
  if (!pattern || pattern.length > MAX_PATTERN) return true;
  try {
    new RegExp(pattern);
    return false;
  } catch {
    return true;
  }
};

/** The `terminal.triggers` row: a list of line patterns with an action each; only a fully valid list is saved. */
export function TriggersRow({ settings, onChange }: { settings: TerminalViewSettings; onChange: (patch: Partial<TerminalViewSettings>) => void }) {
  const saved = settings.terminal?.triggers ?? [];
  const [draft, setDraft] = useState<TerminalTrigger[] | null>(null);
  useEffect(() => setDraft(null), [saved]);
  const value = draft ?? saved;
  const commit = (next: TerminalTrigger[]) => {
    if (next.some((x) => patternError(x.pattern))) {
      setDraft(next);
      return;
    }
    setDraft(null);
    onChange({ terminal: { ...settings.terminal, triggers: next } });
  };
  const update = (id: string, patch: Partial<TerminalTrigger>) => commit(value.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const add = () => commit([...value, { id: crypto.randomUUID(), pattern: '', action: 'highlight' }]);

  return (
    <SettingItem id="terminal.triggers" modified={!deepEqual(saved, [])}>
      <div className="field profiles">
        <span className="mono-label">{t('settings.terminal.triggers')}</span>
        <span className="muted">{t('settings.terminal.triggers.hint')}</span>
        <div className="profile-list">
          {value.map((x) => {
            const bad = patternError(x.pattern);
            return (
              <div key={x.id} className="profile-row">
                <input type="checkbox" checked={x.enabled !== false} aria-label={t('settings.terminal.triggers.enabled')} onChange={(e) => update(x.id, { enabled: e.target.checked ? undefined : false })} />
                <input value={x.name ?? ''} maxLength={80} placeholder={t('settings.terminal.triggers.name')} aria-label={t('settings.terminal.triggers.name')} spellCheck={false} onChange={(e) => update(x.id, { name: e.target.value || undefined })} />
                <input className="mono" value={x.pattern} maxLength={MAX_PATTERN} placeholder={t('settings.terminal.triggers.pattern')} aria-label={t('settings.terminal.triggers.pattern')} aria-invalid={bad} spellCheck={false} onChange={(e) => update(x.id, { pattern: e.target.value })} />
                <select value={x.action} aria-label={t('settings.terminal.triggers.action')} onChange={(e) => update(x.id, { action: e.target.value as TerminalTrigger['action'] })}>
                  {ACTIONS.map((a) => <option key={a} value={a}>{t(`settings.terminal.triggers.action.${a}`)}</option>)}
                </select>
                {x.action === 'highlight' && <input type="color" value={x.color ?? DEFAULT_COLOR} aria-label={t('settings.terminal.triggers.color')} onChange={(e) => update(x.id, { color: e.target.value })} />}
                <label className="setting-check">
                  <input type="checkbox" checked={x.caseSensitive === true} onChange={(e) => update(x.id, { caseSensitive: e.target.checked || undefined })} />
                  <span className="muted">{t('settings.terminal.triggers.caseSensitive')}</span>
                </label>
                <Button title={t('settings.terminal.triggers.delete')} variant="danger" size="xs" icon="trash" onClick={() => commit(value.filter((y) => y.id !== x.id))}>{t('settings.terminal.triggers.delete')}</Button>
                {bad && <span className="req-hint tone-warn">{t(x.pattern ? 'settings.terminal.triggers.invalid' : 'settings.terminal.triggers.empty')}</span>}
              </div>
            );
          })}
        </div>
        <div className="row">
          <Button title={t('settings.terminal.triggers.add')} size="sm" icon="plus" disabled={value.length >= MAX_TRIGGERS} onClick={add}>{t('settings.terminal.triggers.add')}</Button>
        </div>
      </div>
    </SettingItem>
  );
}
