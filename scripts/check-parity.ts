// Layout parity: command ids, routes (views) and default shortcuts must be the same in every layout
// (core behaviours 2, 3 and 11), text output only. Exits 1 on any difference; no images
// (design/reimagine-plan.md, step 9).
// The command list (app/web/src/commands.ts) takes no layout, so a layout can differ in three ways, each checked here:
//  1. its navigation surface drops a view (sidebar and header show every view; Atlas regroups them via ATLAS_GROUPS),
//  2. its shell files bind a shortcut of their own (a `keys: [...]` literal in a layout-specific component),
//  3. it is missing its stylesheet, icon set or structure.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_SET_IDS, LAYOUTS, ORIGINAL_STRUCTURE, type Layout } from '../packages/server-core/src/layouts';

const ROOT = join(import.meta.dir, '..');
const LAYOUT_CSS_DIR = join(ROOT, 'packages/ui/src/layouts');
const SIDEBAR_SRC = join(ROOT, 'packages/ui/src/components/Sidebar.tsx');
/** Components a layout swaps in or that only exist for some layouts: a shortcut declared here is layout-specific. */
const SHELL_SOURCES = ['components/AppFrame.tsx', 'components/HeaderNav.tsx', 'components/StatusBar.tsx', 'components/Sidebar.tsx', 'bridge.ts', 'design.tsx'];
const KEYS_LITERAL = /\bkeys:\s*\[([^\]]*)\]/g;

export interface ParityIssue { layout: string; message: string }

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Ids listed in Atlas's ATLAS_GROUPS (parsed from the source; the constant is not exported). */
export function atlasGroupIds(source: string): string[] {
  const block = source.match(/ATLAS_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
  return [...block.matchAll(/ids:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

export function shellShortcuts(): Array<{ file: string; keys: string[] }> {
  return SHELL_SOURCES.flatMap((rel) => {
    const src = read(join(ROOT, 'packages/ui/src', rel));
    return [...src.matchAll(KEYS_LITERAL)].map((m) => ({ file: rel, keys: [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) }));
  });
}

export async function checkParity(layouts: readonly Layout[] = LAYOUTS): Promise<{ issues: ParityIssue[]; commands: number; routes: number }> {
  // Non-literal specifiers: the app sources need the app's own tsconfig (JSX), not the scripts project's.
  const appSrc = join(ROOT, 'app/web/src');
  const { views } = (await import(join(appSrc, 'views.ts'))) as { views: { ids: string[]; nav: unknown } };
  const { commands, navCommandId } = (await import(join(appSrc, 'commands.ts'))) as {
    commands: (v: unknown) => Array<{ id: string; scope: string; keys?: string[] }>;
    navCommandId: (id: string) => string;
  };
  const baseline = commands(views);
  const issues: ParityIssue[] = [];
  const all = (message: string) => issues.push({ layout: '*', message });

  const ids = new Set<string>();
  const keyOwner = new Map<string, string>();
  const scoped = new Map<string, string>();
  for (const c of baseline) {
    if (ids.has(c.id)) all(`duplicate command id ${c.id}`);
    ids.add(c.id);
    for (const k of c.keys ?? []) {
      const owner = scoped.get(`${c.scope}|${k}`);
      if (owner && owner !== c.id) all(`shortcut ${k} is bound to both ${owner} and ${c.id} in scope ${c.scope}`);
      scoped.set(`${c.scope}|${k}`, c.id);
      keyOwner.set(k, c.id);
    }
  }
  const byId = new Map(baseline.map((c) => [c.id, c]));
  views.ids.forEach((id, i) => {
    const c = byId.get(navCommandId(id));
    if (!c) all(`view ${id} has no ${navCommandId(id)} command`);
    else if (c.keys?.[0] !== `Ctrl+${i + 1}`) all(`${c.id} default shortcut is ${c.keys?.join(', ') ?? 'none'}, expected Ctrl+${i + 1}`);
  });

  const baselineKeys = new Set(keyOwner.keys());
  const extras = shellShortcuts().flatMap((s) => s.keys.filter((k) => !baselineKeys.has(k)).map((k) => `${k} (${s.file})`));
  const atlasIds = atlasGroupIds(read(SIDEBAR_SRC));
  const viewIds = new Set<string>(views.ids);

  for (const l of layouts) {
    const add = (message: string) => issues.push({ layout: l.id, message });
    if (l.id !== 'original' && !existsSync(join(LAYOUT_CSS_DIR, `${l.id}.css`))) add(`missing packages/ui/src/layouts/${l.id}.css`);
    if (!ICON_SET_IDS.includes(l.icons)) add(`unknown icon set ${l.icons}`);
    if (!l.structure.navPlacement) add('structure has no navPlacement');
    // Sidebar and header navs list every view of the one nav; only Atlas builds its own sections.
    const reachable = l.id === 'atlas' ? new Set([...atlasIds.filter((id) => viewIds.has(id)), ...views.ids.filter((id) => !atlasIds.includes(id))]) : viewIds;
    for (const id of views.ids) if (!reachable.has(id)) add(`view ${id} is not reachable from the navigation`);
    if (l.id === 'atlas') for (const id of atlasIds) if (!viewIds.has(id)) add(`ATLAS_GROUPS lists unknown view ${id}`);
    if (l.structure.navFooter === 'none' && l.structure.navPlacement === 'sidebar' && l.id !== 'atlas' && l.id !== 'dossier') add('navFooter none without a swapped shell hides Settings and tools');
    for (const e of extras) add(`shortcut ${e} is not a default shortcut of the command list`);
  }
  void ORIGINAL_STRUCTURE;
  return { issues, commands: baseline.length, routes: views.ids.length };
}

if (import.meta.main) {
  const { issues, commands, routes } = await checkParity();
  console.log(`Parity of ${LAYOUTS.length} layouts: ${commands} commands, ${routes} routes, ${new Set(issues.map((i) => i.layout)).size} layouts with differences.`);
  for (const i of issues) console.log(`  ${i.layout}: ${i.message}`);
  if (issues.length > 0) {
    console.error(`\n${issues.length} parity difference(s). Core behaviours 2, 3 and 11 (~/.library/projects/kedalion/core-behaviours.md).`);
    process.exit(1);
  }
  console.log('All layouts have the same commands, routes and default shortcuts.');
}
