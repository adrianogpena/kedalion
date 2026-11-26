import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_SERVER } from './model';

const LANGUAGE_CODES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'pt-PT', 'pt-BR', 'de-DE', 'de-AT', 'de-CH', 'fr', 'es', 'nl', 'it', 'pl-PL', 'ru-RU', 'uk-UA', 'sv', 'da-DK', 'ca-ES', 'ar', 'ja-JP', 'zh-CN', 'auto'];

export const SPELLCHECK_FIELDS: readonly PanelField[] = [
  { key: 'server', kind: 'string', label: 'dash.spell.server', description: 'dash.spell.server.hint', placeholder: 'dash.spell.server.placeholder', default: DEFAULT_SERVER, maxLength: 200, validate: 'http-url' },
  { key: 'languages', kind: 'text', label: 'dash.spell.languages', description: 'dash.spell.languages.hint', placeholder: 'dash.spell.languages.placeholder', default: '', maxLength: 1000, rows: 4, list: 'text', suggest: { options: LANGUAGE_CODES.map((value) => ({ value })) } },
];

/** Config field lists of the spellcheck panel (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = { spellcheck: SPELLCHECK_FIELDS };
