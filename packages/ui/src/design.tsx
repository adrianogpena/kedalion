import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** Design-preview run (`bun run dev:design`): variants, the switcher and placeholder controls render only when this is true. */
export const designOn: boolean = Boolean((import.meta as { env?: Record<string, unknown> }).env?.VITE_KEDALION_DESIGN);

/** `current` is today's design. */
export type DesignVariant = 'current' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
export const DESIGN_VARIANTS: readonly DesignVariant[] = ['current', 'a', 'b', 'c', 'd', 'e', 'f'];
export const DESIGN_NAMES: Record<DesignVariant, string> = {
  current: 'Current', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F',
};
/** Variants a dev:design run offers per view (switcher rows); empty = Current only. Add entries when an Explore run builds options. */
const OFFERED: Readonly<Record<string, readonly DesignVariant[]>> = {};

/** Whole Reimagine layouts a dev:design run offers (layout switcher); empty = Current only. */
export const OFFERED_LAYOUTS: readonly string[] = [];
/** Skins a dev:design run offers, and the views each supports (detail changes on the current structure); an unsupported view falls back to `current`. */
export const OFFERED_SKINS: Readonly<Record<string, readonly string[]>> = {};

const KEY = (view: string) => `kedalion.design.${view}`;
const EVENT = 'kedalion:design';
export const LAYOUT_KEY = 'kedalion.design.layout';
export const SKIN_KEY = 'kedalion.design.skin';

const readKey = (key: string): string | null => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const writeKey = (key: string, v: string | null) => {
  try { if (v && v !== 'current') window.localStorage.setItem(key, v); else window.localStorage.removeItem(key); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
};
function useDesignTick() {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!designOn) return;
    const on = () => tick((n) => n + 1);
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
}

/** The chosen Reimagine layout, or `current` (flag off, nothing stored or the stored one is not offered). */
export function useDesignLayout(): string {
  useDesignTick();
  if (!designOn) return 'current';
  const v = readKey(LAYOUT_KEY);
  return v && OFFERED_LAYOUTS.includes(v) ? v : 'current';
}

/** The chosen skin for `view`, or `current` when the view does not support it. */
export function useDesignSkin(view: string): string {
  useDesignTick();
  if (!designOn) return 'current';
  const v = readKey(SKIN_KEY);
  return v && (OFFERED_SKINS[view] ?? []).includes(v) ? v : 'current';
}

const read = (view: string): DesignVariant | null => {
  try {
    const v = window.localStorage.getItem(KEY(view));
    return DESIGN_VARIANTS.includes(v as DesignVariant) ? (v as DesignVariant) : null;
  } catch { return null; }
};
const write = (view: string, v: DesignVariant | null) => {
  try { if (v) window.localStorage.setItem(KEY(view), v); else window.localStorage.removeItem(KEY(view)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
};

/** The chosen variant of a view: with the design flag its own override, else the global direction (`global`); else `current`. */
export function useDesign(view: string): DesignVariant {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!designOn) return;
    const on = () => tick((n) => n + 1);
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  if (!designOn) return 'current';
  const offered = OFFERED[view] ?? [];
  const own = read(view);
  if (own && offered.includes(own)) return own;
  const all = read('global');
  if (all && offered.includes(all)) return all;
  return 'current';
}


/** Floating chip under the design flag: the global direction plus a per-view override for each name in `views`. */
export function DesignSwitcher({ views, current }: { views: readonly string[]; current?: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const set = useCallback((view: string, v: DesignVariant | null) => write(view, v), []);
  const global = useDesign('global');
  const layout = useDesignLayout();
  if (!designOn) return null;
  const shown = (current ? [current] : views).filter((v) => (OFFERED[v] ?? []).length > 0);
  const skins = [...new Set(Object.values(OFFERED_SKINS).flat())];
  if (shown.length === 0 && OFFERED_LAYOUTS.length === 0 && skins.length === 0) return null;
  const globalVariants: DesignVariant[] = ['current', ...DESIGN_VARIANTS.filter((v) => shown.some((w) => (OFFERED[w] ?? []).includes(v)))];
  return (
      <div className="design-switcher" role="group" aria-label="Design preview">
        <button type="button" className="design-switcher-chip" aria-expanded={open} onClick={() => setOpen(!open)}>Design · {DESIGN_NAMES[global].split(' ·')[0]}</button>
        {open && (
          <div className="design-switcher-pop">
            <div className="design-switcher-row">
              <span className="mono-label">All</span>
              {globalVariants.map((v) => (
                <button type="button" key={v} className="design-switcher-opt" aria-pressed={global === v} title={DESIGN_NAMES[v]} onClick={() => { for (const w of views) write(w, null); set('global', v); }}>{v === 'current' ? 'Cur' : v.toUpperCase()}</button>
              ))}
            </div>
            {OFFERED_LAYOUTS.length > 0 && (
              <div className="design-switcher-row">
                <span className="mono-label">Layout</span>
                {['current', ...OFFERED_LAYOUTS].map((l) => (
                  <button type="button" key={l} className="design-switcher-opt" aria-pressed={layout === l} onClick={() => writeKey(LAYOUT_KEY, l)}>{l}</button>
                ))}
              </div>
            )}
            {skins.length > 0 && (
              <div className="design-switcher-row">
                <span className="mono-label">Skin</span>
                {['current', ...skins].map((s) => (
                  <button type="button" key={s} className="design-switcher-opt" aria-pressed={(readKey(SKIN_KEY) ?? 'current') === s} onClick={() => writeKey(SKIN_KEY, s)}>{s}</button>
                ))}
              </div>
            )}
            {shown.map((view) => {
              const own = read(view);
              return (
                <div className="design-switcher-row" key={view}>
                  <span className="mono-label">{view}</span>
                  {['current' as DesignVariant, ...(OFFERED[view] ?? [])].map((v) => (
                    <button type="button" key={v} className="design-switcher-opt" aria-pressed={(own ?? global) === v} title={DESIGN_NAMES[v]} onClick={() => set(view, v)}>{v === 'current' ? 'Cur' : v.toUpperCase()}</button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
  );
}
