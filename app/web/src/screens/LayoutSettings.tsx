import {
  DEFAULT_PRESET,
  DENSITY_IDS,
  differsFromPreset,
  effectiveLayouts,
  ICON_SET_IDS,
  NAVIGATION_IDS,
  navToggleApplies,
  optionConflicts,
  PRESETS,
  resolveLayouts,
  SKIN_IDS,
  VIEW_LAYOUTS,
  type LayoutRow,
  type LayoutsSetting,
  type NavToggles,
  type ResolvedLayouts,
} from '@kedalion/server-core/layouts';
import { type ApiError, errorMessage, NavigationPreview, OnOffField, PaletteField, SettingErrorsContext, SettingItem, Tabs, tryT, ViewLayoutPreview } from '@kedalion/ui';
import { useState } from 'react';
import type { Settings } from '../api';
import { t } from '../i18n';

type Change = (patch: Partial<Settings>) => void | Promise<ApiError | null>;

type ViewId = keyof typeof VIEW_LAYOUTS;
const VIEWS = Object.keys(VIEW_LAYOUTS) as ViewId[];
const name = (key: string, id: string): string => tryT(`settings.layout.${key}.${id}`) ?? id;

interface Ctx {
  layouts: LayoutsSetting;
  resolved: ResolvedLayouts;
  modified: readonly LayoutRow[];
  save: (next: LayoutsSetting) => void;
}

/** Why `option` of `row` is blocked, or null when it is allowed (or already the current value). */
function blockReason(resolved: ResolvedLayouts, row: LayoutRow, option: string, current: string): string | null {
  if (option === current) return null;
  const c = optionConflicts(resolved, row, option)[0];
  if (!c) return null;
  if (c.row !== row) return t('settings.layout.reason.requiredBy', { option: name('skin', c.option) });
  return t(`settings.layout.reason.${c.reason}`, { navigation: name('navigation', resolved.navigation) });
}

function ChoiceRow({ id, label, hint, value, options, optionName, row, ctx, modified, onPick, onReset }: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: readonly string[];
  optionName: (o: string) => string;
  row?: LayoutRow;
  ctx: Ctx;
  modified: boolean;
  onPick: (o: string) => void;
  onReset: () => void;
}) {
  const reasons = row ? options.map((o) => ({ o, reason: blockReason(ctx.resolved, row, o, value) })) : [];
  return (
    <SettingItem id={id} modified={modified} onReset={onReset}>
      <label className="field">
        <span className="mono-label">{label}</span>
        <select value={value} aria-label={label} onChange={(e) => onPick(e.target.value)}>
          {options.map((o) => <option key={o} value={o} disabled={!!reasons.find((r) => r.o === o)?.reason}>{optionName(o)}</option>)}
        </select>
        {hint && <span className="muted">{hint}</span>}
        {reasons.filter((r) => r.reason).map((r) => <span key={r.o} className="muted">{optionName(r.o)}: {r.reason}</span>)}
      </label>
    </SettingItem>
  );
}

function ToggleRow({ id, label, row, ctx, value, onPick, onReset }: { id: string; label: string; row: LayoutRow; ctx: Ctx; value: boolean; onPick: (on: boolean) => void; onReset: () => void }) {
  const reason = blockReason(ctx.resolved, row, String(!value), String(value));
  return (
    <SettingItem id={id} modified={ctx.modified.includes(row)} onReset={onReset}>
      <OnOffField label={label} hint={reason} value={value} disabled={!!reason} onChange={onPick} />
    </SettingItem>
  );
}

function GlobalTab({ value, onChange, ctx }: { value: Settings; onChange: Change; ctx: Ctx }) {
  const { layouts, resolved, modified, save } = ctx;
  const base = resolveLayouts({ preset: layouts.preset });
  const custom = modified.length > 0;
  const setNav = (key: keyof NavToggles, v: NavToggles[keyof NavToggles] | undefined) => {
    const nav = { ...layouts.nav } as Record<string, unknown>;
    if (v === undefined || v === base.nav[key]) delete nav[key];
    else nav[key] = v;
    const { nav: _drop, ...rest } = layouts;
    save(Object.keys(nav).length ? { ...rest, nav: nav as NavToggles } : rest);
  };
  const setTop = (key: 'navigation' | 'density' | 'skin', v: string | undefined) => {
    const { [key]: _drop, ...rest } = layouts;
    save(v === undefined || v === base[key] ? rest : { ...rest, [key]: v });
  };
  const navRow = (key: keyof NavToggles) => ({ id: `layouts.nav.${key}`, ctx, row: `nav.${key}` as LayoutRow, onReset: () => setNav(key, undefined) });
  const applies = (key: keyof NavToggles) => navToggleApplies(resolved.navigation, key);
  const ownIcons = resolveLayouts(layouts).icons;
  const iconName = (id: string) => tryT(`iconSet.${id}`) ?? id;
  const presetValue = custom ? '__custom' : layouts.preset;
  const paletteModified = !!(value.paletteDark || value.paletteLight);

  return (
    <div className="settings-format">
      <aside className="settings-format-preview">
        <h4 className="mono-label">{t('settings.layout.preview')}</h4>
        <span className="muted">{t('settings.layout.preview.hint')}</span>
        <NavigationPreview resolved={resolved} />
      </aside>
      <div className="settings-format-options">
        <section className="section">
          <div className="card form">
            <SettingItem id="layouts.preset" modified={custom || layouts.preset !== DEFAULT_PRESET} onReset={() => save({ preset: DEFAULT_PRESET })}>
              <label className="field">
                <span className="mono-label">{t('settings.layout.preset')}</span>
                <select value={presetValue} aria-label={t('settings.layout.preset')} onChange={(e) => save({ preset: e.target.value })}>
                  {custom && <option value="__custom" disabled>{t('settings.layout.preset.custom')}</option>}
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{name('preset', p.id)}</option>)}
                </select>
                <span className="muted">{t('settings.layout.preset.hint')}</span>
              </label>
            </SettingItem>
            <SettingItem id="theme.palette" modified={paletteModified} onReset={() => onChange({ paletteDark: '', paletteLight: '' })}>
              <PaletteField value={value} onChange={onChange} />
            </SettingItem>
            <ChoiceRow
              id="layouts.navigation" label={t('settings.layout.navigation')} value={resolved.navigation} options={NAVIGATION_IDS}
              optionName={(o) => name('navigation', o)} row="navigation" ctx={ctx} modified={modified.includes('navigation')}
              onPick={(o) => setTop('navigation', o)} onReset={() => setTop('navigation', undefined)}
            />
            {applies('labels') && <ToggleRow {...navRow('labels')} label={t('settings.layout.labels')} value={resolved.nav.labels} onPick={(on) => setNav('labels', on)} />}
            {applies('brand') && <ToggleRow {...navRow('brand')} label={t('settings.layout.brand')} value={resolved.nav.brand} onPick={(on) => setNav('brand', on)} />}
            <ToggleRow {...navRow('statusBar')} label={t('settings.layout.statusBar')} value={resolved.nav.statusBar} onPick={(on) => setNav('statusBar', on)} />
            <ChoiceRow
              id="layouts.nav.tabBar" label={t('settings.layout.tabBar')} value={resolved.nav.tabBar} options={['top', 'bottom']}
              optionName={(o) => name('tabBar', o)} row="nav.tabBar" ctx={ctx} modified={modified.includes('nav.tabBar')}
              onPick={(o) => setNav('tabBar', o as 'top' | 'bottom')} onReset={() => setNav('tabBar', undefined)}
            />
            {applies('dock') && (
              <ChoiceRow
                id="layouts.nav.dock" label={t('settings.layout.dock')} value={resolved.nav.dock} options={['left', 'right']}
                optionName={(o) => name('dock', o)} row="nav.dock" ctx={ctx} modified={modified.includes('nav.dock')}
                onPick={(o) => setNav('dock', o as 'left' | 'right')} onReset={() => setNav('dock', undefined)}
              />
            )}
            <SettingItem id="theme.icons" modified={!!value.icons} onReset={() => onChange({ icons: '' })}>
              <label className="field">
                <span className="mono-label">{t('settings.layout.icons')}</span>
                <select value={value.icons ?? ''} aria-label={t('settings.layout.icons')} onChange={(e) => onChange({ icons: e.target.value })}>
                  <option value="">{t('icons.layoutDefault', { name: iconName(ownIcons) })}</option>
                  {ICON_SET_IDS.map((id) => <option key={id} value={id}>{iconName(id)}</option>)}
                </select>
              </label>
            </SettingItem>
            <ChoiceRow
              id="layouts.density" label={t('settings.layout.density')} value={resolved.density} options={DENSITY_IDS}
              optionName={(o) => name('density', o)} ctx={ctx} modified={modified.includes('density')}
              onPick={(o) => setTop('density', o)} onReset={() => setTop('density', undefined)}
            />
            <ChoiceRow
              id="layouts.skin" label={t('settings.layout.skin')} value={resolved.skin} options={SKIN_IDS}
              optionName={(o) => name('skin', o)} row="skin" ctx={ctx} modified={modified.includes('skin')}
              onPick={(o) => setTop('skin', o)} onReset={() => setTop('skin', undefined)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function ViewTab({ view, ctx }: { view: ViewId; ctx: Ctx }) {
  const { layouts, resolved, modified, save } = ctx;
  const base = resolveLayouts({ preset: layouts.preset });
  const setView = (id: string | undefined) => {
    const views = { ...layouts.views };
    if (id === undefined || id === base.views[view]) delete views[view];
    else views[view] = id;
    const { views: _drop, ...rest } = layouts;
    save(Object.keys(views).length ? { ...rest, views } : rest);
  };
  const current = resolved.views[view] ?? VIEW_LAYOUTS[view][0]!;
  return (
    <div className="settings-format">
      <aside className="settings-format-preview">
        <h4 className="mono-label">{t('settings.layout.preview')}</h4>
        <span className="muted">{t('settings.layout.preview.hint')}</span>
        <ViewLayoutPreview view={view} layout={current} resolved={resolved} />
      </aside>
      <div className="settings-format-options">
        <section className="section">
          <div className="card form">
            <ChoiceRow
              id={`layouts.views.${view}`} label={t('settings.layout.viewLayout')} value={current} options={VIEW_LAYOUTS[view]}
              optionName={(o) => name('viewLayout', o)} row={`view.${view}`} ctx={ctx} modified={modified.includes(`view.${view}`)}
              onPick={setView} onReset={() => setView(undefined)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Settings > Appearance > Layout: a Global tab (preset, palette, navigation, look) and one tab per view with layout options. */
export function LayoutSettings({ value, onChange }: { value: Settings; onChange: Change }) {
  const [tab, setTab] = useState('global');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const layouts = effectiveLayouts(value);
  const resolved = resolveLayouts(layouts, value.icons);
  const save = (next: LayoutsSetting) => {
    void Promise.resolve(onChange({ layouts: next })).then((err) => {
      setErrors(err ? { 'layouts.error': errorMessage(err) } : {});
    });
  };
  const ctx: Ctx = { layouts, resolved, modified: differsFromPreset(layouts), save };
  const tabs = [{ id: 'global', label: t('settings.layout.tab.global') }, ...VIEWS.map((v) => ({ id: v, label: t(`nav.${v}`) }))];
  const active = tabs.some((x) => x.id === tab) ? tab : 'global';
  const errorRow = errors['layouts.error'];
  return (
    <SettingErrorsContext.Provider value={errors}>
      <Tabs tabs={tabs} active={active} onChange={setTab} idPrefix="layout-settings" />
      {errorRow && <span className="setting-error" role="alert">{errorRow}</span>}
      <div role="tabpanel" aria-labelledby={`layout-settings-tab-${active}`}>
        {active === 'global' ? <GlobalTab value={value} onChange={onChange} ctx={ctx} /> : <ViewTab view={active as ViewId} ctx={ctx} />}
      </div>
    </SettingErrorsContext.Provider>
  );
}
