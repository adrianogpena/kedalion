import { useEffect, useState } from 'react';
import type { InterceptRule } from '@kedalion/cdp';
import { Button, IconButton } from '@kedalion/ui';
import { browserApi } from './client';
import { t } from './i18n';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Request rules: block a URL pattern or answer it with a fixed response. They apply to every tab until removed. */
export function RulesPane() {
  const [rules, setRules] = useState<InterceptRule[]>([]);
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<'block' | 'mock'>('block');
  const [status, setStatus] = useState('200');
  const [contentType, setContentType] = useState('application/json');
  const [body, setBody] = useState('{}');

  useEffect(() => {
    void browserApi.rules().then((r) => setRules(r.rules)).catch(() => {});
  }, []);

  const save = async (next: InterceptRule[]) => {
    setRules(next);
    try {
      setRules((await browserApi.setRules(next)).rules);
    } catch {
      void browserApi.rules().then((r) => setRules(r.rules)).catch(() => {});
    }
  };
  const add = () => {
    const p = pattern.trim();
    if (!p) return;
    const code = Number(status);
    const rule: InterceptRule =
      action === 'block'
        ? { id: newId(), enabled: true, pattern: p, action }
        : { id: newId(), enabled: true, pattern: p, action, status: Number.isInteger(code) ? code : 200, contentType, body };
    setPattern('');
    void save([...rules, rule]);
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.rules.pattern')} placeholder={t('browser.rules.pattern')} value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <div className="browser-chips" role="group" aria-label={t('browser.rules.action')}>
          <Button size="xs" pressed={action === 'block'} onClick={() => setAction('block')}>{t('browser.rules.block')}</Button>
          <Button size="xs" pressed={action === 'mock'} onClick={() => setAction('mock')}>{t('browser.rules.mock')}</Button>
        </div>
        <Button size="sm" icon="plus" disabled={!pattern.trim()} onClick={add}>{t('browser.rules.add')}</Button>
      </div>
      {action === 'mock' && (
        <div className="browser-pane-bar">
          <input className="rule-status" type="text" inputMode="numeric" aria-label={t('browser.rules.status')} placeholder={t('browser.rules.status')} value={status} onChange={(e) => setStatus(e.target.value)} />
          <input className="rule-type" type="text" spellCheck={false} aria-label={t('browser.rules.contentType')} placeholder={t('browser.rules.contentType')} value={contentType} onChange={(e) => setContentType(e.target.value)} />
          <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.rules.body')} placeholder={t('browser.rules.body')} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      )}
      <div className="net-table-wrap">
        {rules.length === 0 ? (
          <div className="browser-pane-empty">{t('browser.rules.empty')}</div>
        ) : (
          <table className="net-table">
            <thead>
              <tr>
                <th />
                <th>{t('browser.rules.pattern')}</th>
                <th>{t('browser.rules.action')}</th>
                <th>{t('browser.rules.response')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="net-row">
                  <td>
                    <input type="checkbox" aria-label={t('browser.rules.enabled')} checked={r.enabled} onChange={(e) => void save(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} />
                  </td>
                  <td className="net-name" title={r.pattern}>{r.pattern}</td>
                  <td>{t(r.action === 'block' ? 'browser.rules.block' : 'browser.rules.mock')}</td>
                  <td className="cookie-value" title={r.body}>{r.action === 'mock' ? `${r.status ?? 200} ${r.contentType ?? ''} ${r.body ?? ''}` : ''}</td>
                  <td>
                    <IconButton icon="trash" size="xs" label={t('browser.rules.delete')} onClick={() => void save(rules.filter((x) => x.id !== r.id))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
