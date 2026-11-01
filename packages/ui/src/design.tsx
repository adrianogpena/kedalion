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

const KEY = (view: string) => `kedalion.design.${view}`;
const EVENT = 'kedalion:design';

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
  if (!designOn) return null;
  const shown = (current ? [current] : views).filter((v) => (OFFERED[v] ?? []).length > 0);
  if (shown.length === 0) return null;
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
