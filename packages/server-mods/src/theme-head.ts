import { effectiveLayouts, legacyLayoutId, resolveLayouts } from '@kedalion/server-core/layouts';
import { type Palette, paletteFor, TOKENS } from '@kedalion/server-core/palettes';
import type { BaseSettings, SettingsStore } from './settings.ts';

// Same specificity as the token blocks in styles.css; placed after the stylesheet link, so it wins.
const SELECTOR = ':root[data-theme]';

function block(palette: Palette): string {
  const props = TOKENS.map((token) => `${token}:${palette.tokens[token]};`).join('');
  return `${SELECTOR}{color-scheme:${palette.kind};${props}}`;
}

/** The saved palette as a `<style>` before `</head>`, so the first paint has its colours; for `theme: 'system'` a media query picks the side. */
export function themeHtml(html: string, settings: BaseSettings): string {
  const end = html.indexOf('</head>');
  if (end < 0) return html;
  const r = resolveLayouts(effectiveLayouts(settings), settings.icons);
  const attrs: [string, string][] = [['data-layout', legacyLayoutId(r)], ['data-nav', r.navigation], ['data-density', r.density], ['data-skin', r.skin]];
  for (const [name, value] of attrs) {
    if (new RegExp(`<html\\b[^>]*\\b${name}=`).test(html)) {
      html = html.replace(new RegExp(`(<html\\b[^>]*\\b${name}=)(["'])[^"']*\\2`), `$1$2${value}$2`);
    } else {
      html = html.replace(/<html\b([^>]*)>/, `<html$1 ${name}="${value}">`);
    }
  }
  let css: string;
  if (settings.theme === 'system') {
    css = `${block(paletteFor(settings, 'dark'))}@media (prefers-color-scheme: light){${block(paletteFor(settings, 'light'))}}`;
  } else {
    css = block(paletteFor(settings, settings.theme));
    html = html.replace(/(<html\b[^>]*\bdata-theme=)(["'])[^"']*\2/, `$1$2${settings.theme}$2`);
  }
  return html.replace('</head>', `<style id="kedalion-theme">${css}</style>\n</head>`);
}

/** `RunOptions.transformIndex` that inlines the saved theme into `index.html`; `useTheme` takes over once the UI runs. */
export function themeHead(store: SettingsStore<BaseSettings>): (html: string) => Promise<string> {
  return async (html) => themeHtml(html, await store.load());
}
