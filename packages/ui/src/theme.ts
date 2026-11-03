import { useEffect, useState } from 'react';
import { effectiveLayouts, legacyLayoutId, resolveLayouts } from '@kedalion/server-core/layouts';
import { paletteFor, TOKENS, type Palette, type ThemeKind, type ThemeSettings } from '@kedalion/server-core/palettes';

const QUERY = '(prefers-color-scheme: dark)';

/** The OS light/dark setting, live. */
export function useSystemKind(): ThemeKind {
  const [kind, setKind] = useState<ThemeKind>(() => (window.matchMedia(QUERY).matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const listener = (e: MediaQueryListEvent) => setKind(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', listener);
    setKind(mq.matches ? 'dark' : 'light');
    return () => mq.removeEventListener('change', listener);
  }, []);
  return kind;
}

/** Applies the palette the settings name: `data-theme` and every token as an inline property on `<html>`. */
export function useTheme(settings: ThemeSettings): { kind: ThemeKind; palette: Palette } {
  const systemKind = useSystemKind();
  const palette = paletteFor(settings, systemKind);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = palette.kind;
    for (const token of TOKENS) root.style.setProperty(token, palette.tokens[token]);
  }, [palette]);
  const r = resolveLayouts(effectiveLayouts(settings), settings.icons);
  const layoutId = legacyLayoutId(r);
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.layout = layoutId;
    d.nav = r.navigation;
    d.density = r.density;
    d.skin = r.skin;
  }, [layoutId, r.navigation, r.density, r.skin]);
  return { kind: palette.kind, palette };
}

/** Sets the app window's zoom (`settings.zoom`); a no-op in a browser tab. */
export function useZoom(zoom: number | undefined): void {
  useEffect(() => {
    (window as { __kedalionSetZoom?: (factor: number) => void }).__kedalionSetZoom?.(zoom ?? 1);
  }, [zoom]);
}
