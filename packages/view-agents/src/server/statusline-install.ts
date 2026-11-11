import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAccount, AgentStatuslineError, AgentStatuslineStatus } from '../protocol.ts';
import { writeStatuslineFiles } from '../statusline/index.ts';

type Json = Record<string, unknown>;
type StatusLine = { type?: string; command?: string; padding?: number; [k: string]: unknown };
/** Agents state `<dataDir>/agents/statusline.json`, also read by the script: `previous` is the chained statusLine (null: there was none). */
type State = Record<string, { previous: StatusLine | null; command: string }>;

export interface StatuslineInstallerOptions {
  /** `<dataDir>/agents`: holds the script, its launcher, `statusline.json` and `usage/`. */
  agentsDir: string;
  /** Runtime that runs the script; defaults to this process (bun, or the compiled exe). */
  execPath?: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

export type StatuslineResult = { ok: true; status: AgentStatuslineStatus } | { ok: false; error: AgentStatuslineError };

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parsed `settings.json`: `{}` when the file is missing, null when it does not hold a JSON object. */
function readSettings(file: string): { raw: string; json: Json } | null {
  if (!existsSync(file)) return { raw: '', json: {} };
  try {
    const raw = readFileSync(file, 'utf8');
    const json: unknown = raw.trim() ? JSON.parse(raw.replace(/^﻿/, '')) : {};
    return isObject(json) ? { raw, json } : null;
  } catch {
    return null;
  }
}

/** Serializes `json` keeping the file's indent, line endings, final newline and BOM. */
function serialize(json: Json, raw: string): string {
  const indent = /^[ \t]+(?=")/m.exec(raw)?.[0] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(json, null, indent).replace(/\n/g, eol);
  return (raw.startsWith('﻿') ? '﻿' : '') + body + (raw === '' || /\n$/.test(raw) ? eol : '');
}

/** True when `settings.json` is a symlink (shared with another account): writing through it would change that account too. */
function isSharedLink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Account ids that are safe as a shell argument. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

const statusLineOf = (json: Json): StatusLine | undefined => (isObject(json.statusLine) ? (json.statusLine as StatusLine) : undefined);

export function createStatuslineInstaller(opts: StatuslineInstallerOptions) {
  const { agentsDir } = opts;
  const platform = opts.platform ?? process.platform;
  const execPath = opts.execPath ?? process.execPath;
  const now = opts.now ?? (() => new Date());
  const stateFile = join(agentsDir, 'statusline.json');

  const loadState = (): State => {
    try {
      const s: unknown = JSON.parse(readFileSync(stateFile, 'utf8'));
      return isObject(s) ? (s as State) : {};
    } catch {
      return {};
    }
  };
  /** State for a write: `{}` only when the file is missing; null when it exists but cannot be read, so other accounts' `previous` is not dropped. */
  const loadStateForWrite = (): State | null => {
    if (!existsSync(stateFile)) return {};
    try {
      const s: unknown = JSON.parse(readFileSync(stateFile, 'utf8'));
      return isObject(s) ? (s as State) : null;
    } catch {
      return null;
    }
  };
  const saveState = (s: State) => {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(s, null, 2));
    renameSync(`${stateFile}.tmp`, stateFile);
  };

  /** The statusLine command for an account: forward slashes so it survives both cmd and bash. */
  const commandFor = (account: AgentAccount, wrapper: string) => `"${wrapper.replace(/\\/g, '/')}" "${account.id}"`;

  const status = (account: AgentAccount, state = loadState()): AgentStatuslineStatus => {
    const settings = readSettings(join(account.dir, 'settings.json'));
    const entry = state[account.id];
    const current = settings ? statusLineOf(settings.json) : undefined;
    const installed = !!current && !!entry && current.command === entry.command;
    return { account: account.id, label: account.label, installed, previous: entry?.previous?.command || undefined, settingsOk: settings !== null };
  };

  /** Writes `settings.json` with only `statusLine` changed (`undefined` removes it), after a timestamped backup. */
  const writeStatusLine = (account: AgentAccount, value: StatusLine | undefined): AgentStatuslineError | undefined => {
    const file = join(account.dir, 'settings.json');
    if (isSharedLink(file)) return 'sharedSettings';
    const settings = readSettings(file);
    if (!settings) return 'invalidSettings';
    try {
      if (existsSync(file)) {
        const stamp = now().toISOString().replace(/[:.]/g, '-');
        copyFileSync(file, `${file}.kedalion-${stamp}.bak`);
      }
      const next: Json = { ...settings.json };
      if (value === undefined) delete next.statusLine;
      else next.statusLine = value;
      mkdirSync(account.dir, { recursive: true });
      writeFileSync(file, serialize(next, settings.raw));
      return undefined;
    } catch {
      return 'writeFailed';
    }
  };

  return {
    status,
    statuses: (accounts: AgentAccount[]) => {
      const state = loadState();
      return accounts.map((a) => status(a, state));
    },
    /** Rewrites the script and launcher when something is installed, so a moved or updated exe keeps working. */
    refresh() {
      if (Object.keys(loadState()).length === 0) return;
      try {
        writeStatuslineFiles(agentsDir, execPath, platform);
      } catch {
        /* best effort */
      }
    },
    install(account: AgentAccount): StatuslineResult {
      if (!SAFE_ID.test(account.id)) return { ok: false, error: 'unknownAccount' };
      if (isSharedLink(join(account.dir, 'settings.json'))) return { ok: false, error: 'sharedSettings' };
      const settings = readSettings(join(account.dir, 'settings.json'));
      if (!settings) return { ok: false, error: 'invalidSettings' };
      let command: string;
      try {
        command = commandFor(account, writeStatuslineFiles(agentsDir, execPath, platform));
      } catch {
        return { ok: false, error: 'writeFailed' };
      }
      const state = loadStateForWrite();
      if (!state) return { ok: false, error: 'writeFailed' };
      const current = statusLineOf(settings.json);
      if (current?.command === command && state[account.id]) return { ok: true, status: status(account, state) };
      // A statusLine that is not ours is kept for chaining; one of ours left without state has nothing to chain.
      const ours = current && (current.command === command || current.command === state[account.id]?.command);
      const previous = current && !ours ? current : (state[account.id]?.previous ?? null);
      try {
        saveState({ ...state, [account.id]: { previous, command } });
      } catch {
        return { ok: false, error: 'writeFailed' };
      }
      const error = writeStatusLine(account, { type: 'command', command, ...(typeof previous?.padding === 'number' ? { padding: previous.padding } : {}) });
      if (error) {
        try {
          saveState(state);
        } catch {
          /* best effort */
        }
        return { ok: false, error };
      }
      return { ok: true, status: status(account) };
    },
    uninstall(account: AgentAccount): StatuslineResult {
      const state = loadStateForWrite();
      if (!state) return { ok: false, error: 'writeFailed' };
      const entry = state[account.id];
      if (!entry) return { ok: true, status: status(account, state) };
      const settings = readSettings(join(account.dir, 'settings.json'));
      if (!settings) return { ok: false, error: 'invalidSettings' };
      // The user replaced our statusLine since: leave their settings alone and just forget the state.
      if (statusLineOf(settings.json)?.command === entry.command) {
        const error = writeStatusLine(account, entry.previous ?? undefined);
        if (error) return { ok: false, error };
      }
      const { [account.id]: _gone, ...rest } = state;
      try {
        saveState(rest);
      } catch {
        return { ok: false, error: 'writeFailed' };
      }
      return { ok: true, status: status(account, rest) };
    },
  };
}

export type StatuslineInstaller = ReturnType<typeof createStatuslineInstaller>;
