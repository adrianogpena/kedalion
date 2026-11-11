import { posix, win32 } from 'node:path';
import { isShellId, KEDALION_PROFILE_ICON, KEDALION_PROFILE_ID, SHELL_ICONS, SHELL_IDS, SHELL_NAMES, type TerminalProfile, type TerminalProfileInfo } from '../protocol.ts';
import { resolveShell, type ShellLookup } from './shells.ts';

/** Fields a saved entry with a built-in id may override. */
const OVERRIDABLE = ['name', 'icon', 'args', 'env', 'cwd', 'hidden', 'shellIntegration', 'prompt', 'appearance'] as const;

/** Argv a profile runs on this machine; null when its shell or command is missing. */
export function profileArgv(p: TerminalProfile, lookup: ShellLookup): string[] | null {
  const args = p.args ?? [];
  if (p.shell === 'custom') {
    const abs = lookup.platform === 'win32' ? win32.isAbsolute : posix.isAbsolute;
    if (!p.command || !abs(p.command) || !lookup.exists(p.command)) return null;
    return [p.command, ...args];
  }
  if (!isShellId(p.shell)) return null;
  const base = resolveShell(p.shell, lookup);
  return base ? [...base, ...args] : null;
}

/**
 * Built-in profiles (installed shells, with saved overrides applied), then the saved custom ones.
 * Overrides of a shell not installed here are left out; custom profiles always appear, with `available`.
 */
export function mergeProfiles(saved: TerminalProfile[], lookup: ShellLookup): TerminalProfileInfo[] {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const out: TerminalProfileInfo[] = [];
  for (const id of SHELL_IDS) {
    if (id === 'auto' || !resolveShell(id, lookup)) continue;
    const p: TerminalProfileInfo = { id, name: SHELL_NAMES[id], shell: id, icon: SHELL_ICONS[id], available: true };
    const o = byId.get(id);
    if (o) for (const k of OVERRIDABLE) if (o[k] !== undefined) (p as unknown as Record<string, unknown>)[k] = o[k];
    out.push(p);
    if (id === 'git-bash') {
      const k: TerminalProfileInfo = { id: KEDALION_PROFILE_ID, name: 'Kedalion', shell: 'git-bash', icon: KEDALION_PROFILE_ICON, prompt: 'kedalion', available: true };
      const ko = byId.get(KEDALION_PROFILE_ID);
      if (ko) for (const key of OVERRIDABLE) if (ko[key] !== undefined) (k as unknown as Record<string, unknown>)[key] = ko[key];
      out.push(k);
    }
  }
  for (const p of saved) {
    if (isShellId(p.id) || p.id === KEDALION_PROFILE_ID) continue;
    out.push({ ...p, available: profileArgv(p, lookup) !== null });
  }
  return out;
}
