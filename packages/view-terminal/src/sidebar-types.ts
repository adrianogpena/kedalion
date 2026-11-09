export interface SavedPath {
  id: string;
  name: string;
  path: string;
  group?: string;
}
export interface SavedCommand {
  id: string;
  name: string;
  command: string;
  group?: string;
}
export interface SidebarData {
  paths: SavedPath[];
  commands: SavedCommand[];
}

/** Per list. */
export const SIDEBAR_MAX_ITEMS = 200;
/** Per string field. */
export const SIDEBAR_MAX_TEXT = 2000;
const MAX_GROUP = 100;
const ID = /^[\w.-]{1,64}$/;

export const emptySidebar = (): SidebarData => ({ paths: [], commands: [] });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validList<K extends 'path' | 'command'>(raw: unknown, key: K): Array<Record<string, string>> | null {
  if (!Array.isArray(raw) || raw.length > SIDEBAR_MAX_ITEMS) return null;
  const ids = new Set<string>();
  const out: Array<Record<string, string>> = [];
  for (const it of raw) {
    if (!isObj(it)) return null;
    const { id, name, group } = it;
    const value = it[key];
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) return null;
    if (typeof name !== 'string' || name.length > SIDEBAR_MAX_TEXT) return null;
    if (typeof value !== 'string' || !value || value.length > SIDEBAR_MAX_TEXT || value.includes('\0')) return null;
    if (group !== undefined && (typeof group !== 'string' || group.length > MAX_GROUP)) return null;
    ids.add(id);
    out.push(group === undefined ? { id, name, [key]: value } : { id, name, [key]: value, group });
  }
  return out;
}

/** The checked, key-trimmed data, or null on any bad shape. */
export function validSidebar(raw: unknown): SidebarData | null {
  if (!isObj(raw)) return null;
  const paths = validList(raw.paths, 'path');
  const commands = validList(raw.commands, 'command');
  if (!paths || !commands) return null;
  return { paths: paths as unknown as SavedPath[], commands: commands as unknown as SavedCommand[] };
}
