import { effectiveKind, familySibling, PALETTES, resolvePalette, type ThemeKind, type ThemePreference, type ThemeSettings, ZOOM_LEVELS } from '@kedalion/server-core/palettes';
import { isDesktop } from '../api';
import { t } from '../i18n';
import { useSystemKind } from '../theme';

interface Props {
  value: ThemeSettings;
  onChange: (patch: Partial<ThemeSettings>) => void;
}

const PREFERENCES: ThemePreference[] = ['system', 'dark', 'light'];

/** Theme chips (System/Dark/Light). */
export function AppearanceFields({ value, onChange }: Props) {
  return (
    <div className="field">
      <div className="chips">
        {PREFERENCES.map((theme) => (
          <button title={t(`theme.${theme}`)} key={theme} className={`chip${value.theme === theme ? ' chip-on' : ''}`} onClick={() => onChange({ theme })}>
            {t(`theme.${theme}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One palette select for the side in use; a pick keeps the other side in the same family. */
export function PaletteField({ value, onChange }: Props) {
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
    <label className="field">
      <span className="mono-label">{t('theme.palette')}</span>
      <select value={current.id} onChange={(e) => pick(kind, e.target.value)}>
        {PALETTES.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </label>
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
