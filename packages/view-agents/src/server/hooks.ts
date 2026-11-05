import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { invalid } from '@kedalion/server-core';
import { type AgentCategory, type AgentSessionView, STATUS_CATEGORY } from '../protocol.ts';
import type { AgentsSettings } from '../settings-types.ts';
import type { Transitions } from './notify.ts';

export type HookKey = 'onRunning' | 'onWaiting' | 'onDone' | 'onError';

export const HOOK_KEYS: readonly HookKey[] = ['onRunning', 'onWaiting', 'onDone', 'onError'];

const hookHash = (command: string) => createHash('sha256').update(command.trim()).digest('hex');

/**
 * The hook commands the user confirmed in an OS dialog, as sha256 hashes in their own file (not in
 * the settings, so the settings API can't add one). `file` is read lazily: the data dir comes later.
 */
export function createHookApprovals(file: () => string | undefined) {
  let cache: { file: string; hashes: Set<string> } | undefined;
  async function load(): Promise<Set<string>> {
    const f = file();
    if (!f) return new Set();
    if (cache?.file === f) return cache.hashes;
    const raw = (await readJsonFile(f, (v) => typeof v === 'object' && v !== null && Array.isArray((v as { sha256?: unknown }).sha256)).catch(() => undefined)) as { sha256: unknown[] } | undefined;
    cache = { file: f, hashes: new Set((raw?.sha256 ?? []).filter((h): h is string => typeof h === 'string')) };
    return cache.hashes;
  }
  return {
    async isApproved(command: string): Promise<boolean> {
      return (await load()).has(hookHash(command));
    },
    /** Sync check against the loaded hashes; false until `isApproved` or `approve` loaded the file. */
    isApprovedSync(command: string): boolean {
      const f = file();
      return !!f && cache?.file === f && cache.hashes.has(hookHash(command));
    },
    async approve(command: string): Promise<void> {
      const f = file();
      if (!f) throw new Error('Hook approvals are not ready.');
      const hashes = await load();
      hashes.add(hookHash(command));
      await writeJsonAtomic(f, { sha256: [...hashes] }, { mode: 0o600 });
    },
  };
}

export type HookApprovals = ReturnType<typeof createHookApprovals>;

/** Asks the user (an OS dialog) whether a hook command may run; true = allowed. */
export type HookConfirm = (opts: { title: string; message: string; ok?: string; okKey?: string }) => Promise<boolean>;

const HOOK_WHEN: Record<HookKey, string> = { onRunning: 'starts running', onWaiting: 'starts waiting for you', onDone: 'finishes', onError: 'errors or exits' };

/**
 * The settings `check` for the Agents group: each hook whose command is not approved yet (new, changed
 * or set before approvals existed) needs the user's Yes in an OS dialog; a No rejects the whole save
 * with `hookNotApproved`.
 */
export async function checkHookSettings(patch: Record<string, unknown>, _prev: Record<string, unknown>, deps: { approvals: HookApprovals; confirm: HookConfirm }): Promise<void> {
  const next = patch.agents;
  if (typeof next !== 'object' || next === null) return;
  for (const key of HOOK_KEYS) {
    const raw = (next as Record<string, unknown>)[`hooks.${key}`];
    const command = typeof raw === 'string' ? raw.trim() : '';
    if (!command) continue;
    if (await deps.approvals.isApproved(command)) continue;
    const ok = await deps.confirm({
      title: 'Kedalion: allow hook command?',
      message: `Allow Kedalion to run this command when an Agents session ${HOOK_WHEN[key]}?

${command}`,
      ok: 'Allow',
      okKey: 'confirm.allow',
    });
    if (!ok) throw invalid('hookNotApproved', 'The hook command was not approved; settings not saved.');
    await deps.approvals.approve(command);
  }
  const rec = next as Record<string, unknown>;
  const cmd = typeof rec.claudeCommand === 'string' ? rec.claudeCommand.trim() : '';
  const args = Array.isArray(rec.claudeArgs) && rec.claudeArgs.length > 0 ? (rec.claudeArgs as string[]) : undefined;
  const launch: Array<[string, string]> = [];
  if (cmd) launch.push([claudeCommandKey(cmd), `Allow Kedalion to start Claude sessions with this program?\n\n${cmd}`]);
  if (args) launch.push([claudeArgsKey(args), `Allow Kedalion to start Claude sessions with these extra arguments?\n\n${args.join(' ')}`]);
  for (const [key, message] of launch) {
    if (await deps.approvals.isApproved(key)) continue;
    const ok = await deps.confirm({ title: 'Kedalion: allow Claude command?', message, ok: 'Allow', okKey: 'confirm.allow' });
    if (!ok) throw invalid('hookNotApproved', 'The Claude command was not approved; settings not saved.');
    await deps.approvals.approve(key);
  }
}

/** Approval keys of `agents.claudeCommand` and `agents.claudeArgs` (prefixed so a hook approval can't stand in for them). */
export const claudeCommandKey = (command: string) => `claudeCommand:${command.trim()}`;
export const claudeArgsKey = (args: readonly string[]) => `claudeArgs:${JSON.stringify(args)}`;

export type HookSpawn = (command: string, opts: { cwd?: string; env: Record<string, string> }) => Promise<void>;

export interface HooksOptions {
  settings: () => Promise<AgentsSettings | undefined>;
  /** Flash a hook problem as a toast (title: what happened, body: details). */
  flash: (title: string, body: string) => void;
  /** Starts the command detached; rejects when it cannot start. */
  spawn?: HookSpawn;
  /** Only approved commands run. */
  approvals: Pick<HookApprovals, 'isApproved'>;
}

/** Hook for a status: by category, with Done split from Waiting. */
export function hookKey(status: AgentSessionView['status']): HookKey | undefined {
  if (status === 'done') return 'onDone';
  const cat: AgentCategory = STATUS_CATEGORY[status];
  return cat === 'running' ? 'onRunning' : cat === 'waiting' ? 'onWaiting' : cat === 'error' ? 'onError' : undefined;
}

export const defaultHookSpawn: HookSpawn = (command, { cwd, env }) =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'cmd' : 'sh', win ? ['/C', command] : ['-c', command], {
      cwd: cwd && existsSync(cwd) ? cwd : undefined,
      env: { ...process.env, ...env },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

/** Runs the user's hook command on each status transition (shared detection with the notifier). */
export function createHooks(opts: HooksOptions, transitions: Transitions) {
  const run = opts.spawn ?? defaultHookSpawn;
  /** Unapproved commands already flashed. */
  const warned = new Set<string>();
  return {
    async observe(sessions: AgentSessionView[]): Promise<void> {
      const changed = transitions.diff(sessions);
      if (changed.length === 0) return;
      const cfg = await opts.settings().catch(() => undefined);
      if (!cfg) return;
      for (const s of changed) {
        const key = hookKey(s.status);
        const raw = key ? cfg[`hooks.${key}` as const] : undefined;
        const command = typeof raw === 'string' ? raw.trim() : '';
        if (!command) continue;
        if (!(await opts.approvals.isApproved(command).catch(() => false))) {
          if (!warned.has(command)) {
            warned.add(command);
            opts.flash('Hook not approved', 'Edit and apply it in Settings > Agents to confirm it');
          }
          continue;
        }
        const env = { KEDALION_SESSION_ID: s.id, KEDALION_STATUS: s.status, KEDALION_LABEL: s.name || s.title || s.firstPrompt || s.id, KEDALION_PROJECT: s.project ?? '', KEDALION_CWD: s.cwd };
        void run(command, { cwd: s.cwd, env }).catch((e: unknown) => opts.flash('Hook failed to start', e instanceof Error ? e.message : String(e)));
      }
    },
  };
}
