import { DEFAULT_LINK_SETTINGS, SettingItem, SettingRow, tryT, type LinkTarget } from '@kedalion/ui';
import { dashboardPanels } from '@kedalion/view-grid/web';
import type { Settings } from '../api';
import { t } from '../i18n';
import { linkSettingsOf, settingsRegistry } from '../settings';
import { views } from '../views';

type Change = (patch: Partial<Settings>) => void;

const TARGETS: readonly LinkTarget[] = ['internal', 'external'];

/** The scopes the page lists: one per view (not the browser itself) and one per Dashboard panel kind. */
const viewScopes = () => views.ids.filter((id: string) => id !== 'browser').map((id) => ({ scope: `view:${id}`, label: views.label(id) }));
const panelScopes = () => dashboardPanels.map((k) => ({ scope: `panel:${k.kind}`, label: tryT(k.title) ?? k.title }));

function ScopeRow({ scope, label, settings, onChange }: { scope: string; label: string; settings: Settings; onChange: Change }) {
  const scopes = linkSettingsOf(settings).scopes;
  const current = Object.hasOwn(scopes, scope) ? scopes[scope] : undefined;
  const fallback = Object.hasOwn(DEFAULT_LINK_SETTINGS.scopes, scope) ? DEFAULT_LINK_SETTINGS.scopes[scope] : undefined;
  const save = (target: LinkTarget | undefined) => {
    const next = { ...scopes };
    if (target) next[scope] = target;
    else delete next[scope];
    onChange({ links: { ...settings.links, scopes: next } });
  };
  return (
    <SettingItem id={`links.scopes.${scope}`} modified={current !== fallback} onReset={() => save(fallback)}>
      <label className="field">
        <span className="mono-label">{label}</span>
        <select value={current ?? ''} aria-label={label} onChange={(e) => save((e.target.value || undefined) as LinkTarget | undefined)}>
          <option value="">{t('settings.links.default')}</option>
          {TARGETS.map((v) => <option key={v} value={v}>{t(`settings.links.openIn.${v}`)}</option>)}
        </select>
      </label>
    </SettingItem>
  );
}

/** Settings › General › Links: the global target, then one row per view and per Dashboard panel kind. */
export function LinksSettings({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const rows = (list: { scope: string; label: string }[]) =>
    list.map((r) => <ScopeRow key={r.scope} scope={r.scope} label={r.label} settings={settings} onChange={onChange} />);
  return (
    <>
      <section className="section">
        <div className="card form">
          <SettingRow def={settingsRegistry.setting('links.openIn')!} settings={settings} onChange={onChange} />
        </div>
      </section>
      <section className="section">
        <h4 className="mono-label" style={{ margin: '0 0 8px 12px' }}>{t('settings.links.views')}</h4>
        <div className="card form">{rows(viewScopes())}</div>
      </section>
      <section className="section">
        <h4 className="mono-label" style={{ margin: '0 0 8px 12px' }}>{t('settings.links.panels')}</h4>
        <div className="card form">{rows(panelScopes())}</div>
      </section>
    </>
  );
}
