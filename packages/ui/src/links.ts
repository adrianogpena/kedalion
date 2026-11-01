export type LinkTarget = 'internal' | 'external';

export interface LinkSettings {
  openIn: LinkTarget;
  /** Per scope (`data-link-scope`) override of `openIn`. */
  scopes: Record<string, LinkTarget>;
}

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
  openIn: 'internal',
  scopes: { 'panel:tickets': 'external', 'panel:github-prs': 'external', 'panel:github-tracked': 'external' },
};

/** Every `data-link-scope` from `el` outwards, innermost first. */
export function scopesOf(el: Element | null): string[] {
  const out: string[] = [];
  for (let n = el; n; n = n.parentElement) {
    const s = n.getAttribute('data-link-scope');
    if (s) out.push(s);
  }
  return out;
}

/** The innermost scope with a setting wins, else the global setting. */
export function resolveLinkTarget(scopes: string[], s: LinkSettings): LinkTarget {
  for (const scope of scopes) {
    const target = Object.hasOwn(s.scopes, scope) ? s.scopes[scope] : undefined;
    if (target) return target;
  }
  return s.openIn;
}

/** The absolute http(s) URL of `href` when it is not on `base`'s origin, else null. */
export function routableUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin === new URL(base).origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The routable URL of the closest `<a>` (HTML or SVG) around `target`, with that link. */
export function linkAt(target: EventTarget | null): { a: Element; url: string } | null {
  const el = target instanceof Element ? target : null;
  const a = el?.closest('a');
  if (!a) return null;
  const url = routableUrl(a.getAttribute('href') ?? a.getAttribute('xlink:href'), window.location.href);
  return url ? { a, url } : null;
}

export interface LinkRouter {
  settings: () => LinkSettings;
  open: (url: string, target: LinkTarget) => void;
}

/** Routes clicks on external links and `window.open` of external URLs to `open`. Returns the uninstall function. */
export function installLinkRouter({ settings, open }: LinkRouter): () => void {
  let last: EventTarget | null = null;
  const track = (e: Event) => { last = e.target; };
  const onClick = (e: Event) => {
    if (e.type === 'auxclick' && (e as MouseEvent).button !== 1) return;
    const hit = linkAt(e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    open(hit.url, resolveLinkTarget(scopesOf(hit.a), settings()));
  };
  window.addEventListener('pointerdown', track, true);
  window.addEventListener('keydown', track, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  const previous = window.open;
  window.open = ((url?: string | URL, ...rest: unknown[]) => {
    const routed = routableUrl(url === undefined ? null : String(url), window.location.href);
    if (!routed) return (previous as (...a: unknown[]) => Window | null).call(window, url, ...rest);
    open(routed, resolveLinkTarget(scopesOf(last instanceof Element ? last : null), settings()));
    return null;
  }) as typeof window.open;
  const mine = window.open;
  return () => {
    window.removeEventListener('pointerdown', track, true);
    window.removeEventListener('keydown', track, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('auxclick', onClick, true);
    if (window.open === mine) window.open = previous;
  };
}
