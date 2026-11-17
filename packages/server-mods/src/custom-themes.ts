import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Palette, PALETTES } from '@kedalion/server-core/palettes';
import { buildCustomTheme, listAllThemes, type ThemeSkip } from './theme-merge.ts';

/** `<settings dir>/themes`, the settings dir defaulting to `~/.kedalion`. */
export function themesDir(settingsDir: string = join(homedir(), '.kedalion')): string {
  return join(settingsDir, 'themes');
}

/** Loads `*.json` theme files from `dir`; missing dir gives none, bad files are skipped with a reason. */
export async function loadCustomThemes(
  dir: string = themesDir(),
  builtins: readonly Palette[] = PALETTES,
): Promise<{ themes: Palette[]; skipped: ThemeSkip[] }> {
  const themes: Palette[] = [];
  const skipped: ThemeSkip[] = [];
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { themes, skipped };
    throw err;
  }
  for (const file of files) {
    const name = file.slice(0, -'.json'.length);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
    } catch (err) {
      skipped.push({ name, reason: `unreadable: ${(err as Error).message}` });
      continue;
    }
    const built = buildCustomTheme(name, raw, builtins);
    if ('error' in built) skipped.push({ name, reason: built.error });
    else themes.push(built.palette);
  }
  return { themes, skipped };
}

/** Built-in palettes plus the custom ones from `dir`. */
export async function listAllThemesFrom(dir?: string): Promise<{ themes: Palette[]; skipped: ThemeSkip[] }> {
  const { themes, skipped } = await loadCustomThemes(dir);
  return { themes: listAllThemes(PALETTES, themes), skipped };
}
