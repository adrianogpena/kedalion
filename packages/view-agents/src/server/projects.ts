import { readFileSync } from 'node:fs';
import type { AgentProject } from '../protocol.ts';
import { quarantine, writeJsonSync } from './session-state.ts';

export interface ProjectsStore {
  /** The shown projects (hidden ones left out). */
  list(): AgentProject[];
  /** Adds a picked folder; a hidden one is un-hidden (same id). */
  add(input: { name?: unknown; path?: unknown }): AgentProject | null;
  /** Hides the project (nothing else is touched). */
  remove(id: string): boolean;
  /** Keys of the hidden projects. */
  hidden(): string[];
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const same = (a: string, b: string) => slash(a) === slash(b);

/** The key of a project: its picked path, slash-normalised and lowercased. */
export const projectKey = slash;

/** The projects added to the Agents view, kept in `file` (`{projects, hidden}`; a bare `{id, name, path}[]` is read too). */
export function createProjectsStore(file: string): ProjectsStore {
  let items: AgentProject[] | undefined;
  let hid: string[] = [];
  let unreadable = false;
  const load = () => {
    if (items) return items;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      items = [];
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') unreadable = true;
      return items;
    }
    try {
      const raw = JSON.parse(text) as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { projects?: unknown })?.projects;
      const h = Array.isArray(raw) ? [] : (raw as { hidden?: unknown })?.hidden;
      items = Array.isArray(list)
        ? list.filter((p): p is AgentProject => !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string')
        : [];
      hid = Array.isArray(h) ? h.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      items = [];
      quarantine(file);
    }
    return items;
  };
  const save = () => {
    if (!unreadable) writeJsonSync(file, { projects: items ?? [], hidden: hid });
  };
  return {
    list: () => load().filter((x) => !hid.includes(slash(x.path))),
    hidden: () => (load(), [...hid]),
    add({ name, path }) {
      if (typeof path !== 'string' || !path.trim()) return null;
      const p = path.trim();
      const existing = load().find((x) => same(x.path, p));
      if (existing) {
        if (hid.includes(slash(existing.path))) {
          hid = hid.filter((k) => k !== slash(existing.path));
          save();
        }
        return existing;
      }
      const project = { id: crypto.randomUUID(), name: typeof name === 'string' && name.trim() ? name.trim() : base(p), path: p };
      load().push(project);
      save();
      return project;
    },
    remove(id) {
      const x = load().find((y) => y.id === id);
      if (!x || hid.includes(slash(x.path))) return false;
      hid.push(slash(x.path));
      save();
      return true;
    },
  };
}
