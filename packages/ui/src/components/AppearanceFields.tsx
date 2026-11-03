import { effectiveKind, familySibling, PALETTES, resolvePalette, type ThemeKind, type ThemePreference, type ThemeSettings, ZOOM_LEVELS } from '@kedalion/server-core/palettes';
import { DEFAULT_LAYOUT, hasLabelledMenu, ICON_SET_IDS, LAYOUTS, resolveLayout, SELECTABLE_LAYOUT_IDS, supportsDock } from '@kedalion/server-core/layouts';
import { isDesktop } from '../api';
import { t, tryT } from '../i18n';
import { SettingItem } from './SettingFields';
import { useSystemKind } from '../theme';

interface Props {
  value: ThemeSettings;
  onChange: (patch: Partial<ThemeSettings>) => void;
}

const PREFERENCES: ThemePreference[] = ['system', 'dark', 'light'];

/** Theme chips (System/Dark/Light) and one palette select for the side in use; a pick keeps the other side in the same family. */
export function AppearanceFields({ value, onChange }: Props) {
  const kind = effectiveKind(value.theme, useSystemKind());
  const current = kind === 'dark'
    ? resolvePalette('dark', value.paletteDark, value.paletteLight)
    : resolvePalette('light', value.paletteLight, value.paletteDark);

  const pick = (kind: ThemeKind, id: string) => {
    const otherKind = kind === 'dark' ? 'light' : 'dark';
    const sibling = familySibling(id, otherKind);
    const own = kind === 'dark' ? 'paletteDark' : 'paletteLight';
    const other = kind === 'dark' ? 'paletteLight' : 'paletteDark';
    onChange(sibling ? { [own]: id, [other]: sibling.id } : { [own]: id });
  };

  return (
    <>
      <div className="field">
        <div className="chips">
          {PREFERENCES.map((theme) => (
            <button title={t(`theme.${theme}`)} key={theme} className={`chip${value.theme === theme ? ' chip-on' : ''}`} onClick={() => onChange({ theme })}>
              {t(`theme.${theme}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="mono-label">{t('theme.palette')}</span>
        <select value={current.id} onChange={(e) => pick(kind, e.target.value)}>
          {PALETTES.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
    </>
  );
}

/** The app window's zoom (applied by `useZoom`); a browser tab has the browser's own. */
export function ZoomField({ value, onChange }: Props) {
  return (
    <label className="field">
      <span className="mono-label">{t('zoom.label')}</span>
      {isDesktop && (
        <select value={value.zoom ?? 1} onChange={(e) => onChange({ zoom: Number(e.target.value) })}>
          {ZOOM_LEVELS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
      )}
      <span className="muted">{t(isDesktop ? 'zoom.hint' : 'zoom.browser')}</span>
    </label>
  );
}

/** The layout select; own setting row (modified bar when not the default layout). */
export function LayoutField({ value, onChange }: Props) {
  const current = resolveLayout(value.layout);
  return (
    <SettingItem id="theme.layout" modified={current.id !== DEFAULT_LAYOUT}>
      <label className="field">
        <span className="mono-label">{t('theme.layout')}</span>
        <select value={current.id} onChange={(e) => onChange({ layout: e.target.value })}>
          {LAYOUTS.filter((l) => SELECTABLE_LAYOUT_IDS.includes(l.id) || l.id === current.id).map((l) => <option key={l.id} value={l.id}>{tryT(`layout.${l.id}`) ?? l.label}</option>)}
        </select>
      </label>
    </SettingItem>
  );
}

/** Main menu style (labels or icons); rendered only when the active layout has a labelled menu. */
export function MainMenuField({ value, onChange }: Props) {
  if (!hasLabelledMenu(resolveLayout(value.layout).structure)) return null;
  const mode = value.mainMenu ?? 'labels';
  return (
    <SettingItem id="theme.mainMenu" modified={mode !== 'labels'}>
      <label className="field">
        <span className="mono-label">{t('settings.appearance.mainMenu')}</span>
        <select value={mode} onChange={(e) => onChange({ mainMenu: e.target.value as 'labels' | 'icons' })}>
          <option value="labels">{t('settings.appearance.mainMenuLabels')}</option>
          <option value="icons">{t('settings.appearance.mainMenuIcons')}</option>
        </select>
        <span className="muted">{t('settings.appearance.mainMenuDesc')}</span>
      </label>
    </SettingItem>
  );
}

/** The icon-set select; '' follows the layout's own set. */
export function IconsField({ value, onChange }: Props) {
  const own = resolveLayout(value.layout).icons;
  const name = (id: string) => tryT(`iconSet.${id}`) ?? id;
  return (
    <SettingItem id="theme.icons" modified={!!value.icons}>
      <label className="field">
        <span className="mono-label">{t('theme.icons')}</span>
        <select value={value.icons ?? ''} onChange={(e) => onChange({ icons: e.target.value })}>
          <option value="">{t('icons.layoutDefault', { name: name(own) })}</option>
          {ICON_SET_IDS.map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select>
      </label>
    </SettingItem>
  );
}

/** Dock side (left or right); disabled with a note for layouts with a header menu. */
export function DockField({ value, onChange }: Props) {
  const layout = resolveLayout(value.layout);
  const supported = supportsDock(layout.id);
  const side = value.dock ?? layout.structure.sidebarSide;
  return (
    <SettingItem id="theme.dock" modified={!!value.dock}>
      <label className="field">
        <span className="mono-label">{t('settings.appearance.dock')}</span>
        <select value={side} disabled={!supported} onChange={(e) => onChange({ dock: e.target.value as 'left' | 'right' })}>
          <option value="left">{t('settings.appearance.dockLeft')}</option>
          <option value="right">{t('settings.appearance.dockRight')}</option>
        </select>
        <span className="muted">{t(supported ? 'settings.appearance.dockDesc' : 'settings.appearance.dockUnsupported')}</span>
      </label>
    </SettingItem>
  );
}
