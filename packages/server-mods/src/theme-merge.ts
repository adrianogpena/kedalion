import { type Palette, TOKENS, type Token, type ThemeKind } from '@kedalion/server-core/palettes';

/** A custom theme file: a partial override of a built-in palette (`base`, one level only). */
export interface ThemeOverride {
  label?: string;
  base?: string;
  kind?: ThemeKind;
  family?: string;
  tokens?: Partial<Record<Token, string>>;
}

export interface ThemeSkip {
  name: string;
  reason: string;
}

const TOKEN_SET: ReadonlySet<string> = new Set(TOKENS);

/** Only the known tokens with a non-empty string value. */
export function definedTokens(raw: unknown): Partial<Record<Token, string>> {
  const out: Partial<Record<Token, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (TOKEN_SET.has(k) && typeof v === 'string' && v.trim()) out[k as Token] = v;
  }
  return out;
}

/** The base tokens with the override's defined known tokens laid over them; the base is not mutated. */
export function mergeTokens(base: Record<Token, string>, override: unknown): Record<Token, string> {
  return { ...base, ...definedTokens(override) };
}

/** A theme file name usable as an id: no `..`, separators, drive letters or control characters. */
export function themeNameError(name: string): string | null {
  if (!name) return 'empty name';
  if (name.length > 64) return 'name too long';
  if (name.includes('..')) return 'name contains ..';
  if (/[\\/]/.test(name)) return 'name contains a path separator';
  if (/^[A-Za-z]:/.test(name)) return 'name starts with a drive letter';
  if (!/^[\w][\w .-]*$/.test(name)) return 'name has invalid characters';
  return null;
}

/** Builds a palette from a parsed theme file over a built-in base; the error says why it cannot. */
export function buildCustomTheme(
  name: string,
  raw: unknown,
  builtins: readonly Palette[],
): { palette: Palette } | { error: string } {
  const bad = themeNameError(name);
  if (bad) return { error: bad };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a JSON object' };
  const o = raw as Record<string, unknown>;
  const baseId = typeof o.base === 'string' && o.base ? o.base : undefined;
  const kind = o.kind === 'dark' || o.kind === 'light' ? o.kind : undefined;
  const base = baseId
    ? builtins.find((p) => p.id === baseId)
    : builtins.find((p) => p.kind === (kind ?? 'dark'));
  if (!base) return { error: baseId ? `unknown base "${baseId}"` : 'no base palette' };
  const id = `custom:${name}`;
  return {
    palette: {
      id,
      label: typeof o.label === 'string' && o.label.trim() ? o.label : name,
      family: typeof o.family === 'string' && o.family ? o.family : id,
      kind: kind ?? base.kind,
      tokens: mergeTokens(base.tokens, o.tokens),
    },
  };
}

/** Built-ins followed by the custom palettes; a custom id never replaces a built-in. */
export function listAllThemes(builtins: readonly Palette[], custom: readonly Palette[]): Palette[] {
  const ids = new Set(builtins.map((p) => p.id));
  return [...builtins, ...custom.filter((p) => !ids.has(p.id))];
}
