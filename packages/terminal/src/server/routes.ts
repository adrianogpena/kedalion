import { AppError, invalid, isRecord, notFound, socketTickets, type Routes, type SocketData, type SocketRoutes } from '@kedalion/server-core';
import type { ServerWebSocket } from 'bun';
import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, posix, resolve, win32 } from 'node:path';
import { decodeClientMessage, MAX_COLS, MAX_ROWS, TERMINAL_SOCKET_PATH, type TerminalProfile, type TerminalProfileInfo } from '../protocol.ts';
import type { PromptStyle } from '../prompt.ts';
import { ensureIntegrationFiles, integratedShell, type TerminalPrompt, withIntegration } from './integration.ts';
import type { Launchers } from './launchers.ts';
import { mergeProfiles, profileArgv } from './profiles.ts';
import { availableShells, isShellId, resolveShell, type ShellId, type ShellLookup } from './shells.ts';
import type { Sink, TerminalSessions, ViewKind } from './sessions.ts';

/** Sockets with more than this queued are closed with BACKPRESSURE_CLOSE instead of buffering without bound. */
export const MAX_BUFFERED = 1024 * 1024;
export const BACKPRESSURE_CLOSE = 4001;

export interface TerminalRoutesOptions {
  sessions: TerminalSessions;
  /** The configured shell id (the `terminal.shell` setting); anything but a known id means `auto`. */
  shell: () => Promise<string>;
  /** Resolves a project root id and relative path to an existing directory, or throws. Required for `root`. */
  resolveCwd?: (root: string, path: string) => Promise<string>;
  launchers?: Launchers;
  /** The saved `terminal.profiles` (overrides of built-ins and custom profiles). */
  profiles?: () => Promise<TerminalProfile[]>;
  /** Profile id used when `open` names none; '' or unknown falls back to `shell`. */
  defaultProfile?: () => Promise<string>;
  /** Start directory when neither the request nor the profile gives one (`~` = home). */
  defaultCwd?: () => Promise<string>;
  /** The `terminal.shellIntegration` setting; integration is on unless this resolves false. */
  shellIntegration?: () => Promise<boolean>;
  /** The `terminal.prompt` setting; `'kedalion'` replaces the shell's prompt (needs shell integration). */
  prompt?: () => Promise<TerminalPrompt>;
  /** The `terminal.promptStyle` setting (already validated); the default style when undefined. */
  promptStyle?: () => Promise<PromptStyle | undefined>;
  /** Where the integration scripts are written (default: a folder in the temp dir). */
  integrationDir?: string;
  /** Where shells are looked up; tests replace it. */
  lookup?: ShellLookup;
  /** Directory check for cwd candidates; tests replace it. */
  isDir?: (path: string) => boolean;
}

interface Ticket {
  session: string;
  view: ViewKind;
}

const badRequest = () => invalid('badRequest', 'Invalid request.');

function size(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw badRequest();
  return v;
}

function sessionId(b: Record<string, unknown>): string {
  if (typeof b.session !== 'string' || !b.session) throw badRequest();
  return b.session;
}

function querySession(q: URLSearchParams): string {
  const id = q.get('session');
  if (!id) throw badRequest();
  return id;
}

const MAX_RESOLVE = 100;
const MAX_PATH = 1024;

/**
 * The absolute path of `p` (from a terminal line) when it exists: relative to `cwd`, `~` is home, and a Git Bash
 * `/c/...` is `C:/...` on Windows. A folder ends with `/`. Null when there is nothing there.
 */
export function resolveTerminalPath(p: string, cwd: string, platform: string, kind: (path: string) => 'file' | 'dir' | null): string | null {
  if (!p || p.length > MAX_PATH || p.includes('\0')) return null;
  let path = p;
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) path = homedir() + path.slice(1);
  if (platform === 'win32') {
    const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(path);
    if (msys) path = `${msys[1].toUpperCase()}:${msys[2] ?? '/'}`;
  }
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  const k = kind(abs);
  return k === 'dir' ? `${abs.replace(/[\\/]+$/, '')}/` : k === 'file' ? abs : null;
}

export function terminalRoutes(opts: TerminalRoutesOptions): { routes: Routes; sockets: SocketRoutes } {
  const { sessions } = opts;
  const lookup: ShellLookup = opts.lookup ?? { platform: process.platform, env: process.env, exists: existsSync };
  const tickets = socketTickets<Ticket>();

  const isDir = opts.isDir ?? ((p: string) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  const abs = lookup.platform === 'win32' ? win32.isAbsolute : posix.isAbsolute;
  const integrationDir = opts.integrationDir ?? join(tmpdir(), 'kedalion-shell-integration');

  async function pickShell(): Promise<{ id: ShellId; argv: string[] }> {
    const configured = await opts.shell();
    const id = isShellId(configured) ? configured : 'auto';
    const argv = resolveShell(id, lookup);
    if (argv) return { id, argv };
    const fallback = resolveShell('auto', lookup);
    if (!fallback) throw invalid('terminalNoShell', 'No shell found on this machine.');
    return { id: 'auto', argv: fallback };
  }

  const listProfiles = async () => mergeProfiles((await opts.profiles?.()) ?? [], lookup);

  /** The requested profile, else the default profile, else the `shell` setting (no profile). */
  async function pickProfile(requested: string | undefined): Promise<{ id: ShellId | 'custom'; argv: string[]; profile?: TerminalProfileInfo }> {
    const all = requested !== undefined || opts.defaultProfile ? await listProfiles() : [];
    if (requested !== undefined) {
      const profile = all.find((p) => p.id === requested);
      if (!profile) throw invalid('terminalProfile', 'Unknown terminal profile.');
      const argv = profileArgv(profile, lookup);
      if (!argv) throw invalid('terminalNoShell', 'The profile shell is not on this machine.');
      return { id: profile.shell, argv, profile };
    }
    const fallbackId = await opts.defaultProfile?.();
    const profile = fallbackId ? all.find((p) => p.id === fallbackId) : undefined;
    const argv = profile && profileArgv(profile, lookup);
    if (profile && argv) return { id: profile.shell, argv, profile };
    return pickShell();
  }

  /** An absolute existing directory from `p` (`~` = home), or null. */
  function dirOf(p: string | undefined): string | null {
    if (!p) return null;
    const expanded = p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? homedir() + p.slice(1) : p;
    return abs(expanded) && isDir(expanded) ? expanded : null;
  }

  /** root/path > dir > profile cwd > defaultCwd > home. */
  async function cwdOf(b: Record<string, unknown>, profile: TerminalProfileInfo | undefined): Promise<string> {
    const { root, path } = b;
    if (root !== undefined) {
      if (typeof root !== 'string' || (path !== undefined && typeof path !== 'string')) throw badRequest();
      if (!opts.resolveCwd) throw invalid('notADirectory', 'Working directories are not available.');
      return opts.resolveCwd(root, path ?? '');
    }
    return dirOf(b.dir as string | undefined) ?? dirOf(profile?.cwd) ?? dirOf(await opts.defaultCwd?.()) ?? homedir();
  }

  const routes: Routes = {
    'POST /api/terminal/open': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const cols = size(b.cols, MAX_COLS);
      const rows = size(b.rows, MAX_ROWS);
      if (b.launch !== undefined && (!isRecord(b.launch) || typeof b.launch.id !== 'string')) throw badRequest();
      if (b.profile !== undefined && typeof b.profile !== 'string') throw badRequest();
      if (b.dir !== undefined && typeof b.dir !== 'string') throw badRequest();
      const shell = await pickProfile(b.profile as string | undefined);
      const profile = shell.profile;
      let cmd = shell.argv;
      let label: string = profile?.name ?? (shell.id === 'auto' ? 'shell' : shell.id);
      let env: Record<string, string> | undefined = profile?.env;
      let launcher: string | undefined;
      let meta: Record<string, unknown> | undefined;
      let shellId: string | undefined = shell.id;
      if (b.launch !== undefined) {
        const resolved = opts.launchers?.resolve((b.launch as Record<string, unknown>).id, (b.launch as Record<string, unknown>).args, {
          shell: shell.argv,
        });
        if (!resolved) throw invalid('terminalLauncher', 'Unknown or invalid launcher.');
        ({ cmd, env, label, meta, launcher } = resolved);
        shellId = undefined;
      } else {
        const kind = shell.id === 'custom' ? null : integratedShell(shell.id, cmd);
        if (kind && profile?.shellIntegration !== false && (await opts.shellIntegration?.()) !== false) {
          ensureIntegrationFiles(integrationDir);
          const injected = withIntegration(kind, cmd, integrationDir, { ...lookup.env, ...env }, { prompt: await opts.prompt?.(), style: await opts.promptStyle?.() });
          cmd = injected.argv;
          env = { ...env, ...injected.env };
        }
      }
      const cwd = await cwdOf(b, launcher ? undefined : profile);
      const session = sessions.create({ cmd, cwd, cols, rows, env, label, launcher, meta, profile: launcher ? undefined : profile?.id, shell: shellId });
      return { session: session.id, ticket: tickets.issue({ session: session.id, view: 'interactive' }) };
    },

    'POST /api/terminal/attach': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const id = sessionId(b);
      if (b.view !== undefined && b.view !== 'interactive' && b.view !== 'preview') throw badRequest();
      if (!sessions.get(id)) throw notFound('terminalSession', 'No such terminal session');
      return { session: id, ticket: tickets.issue({ session: id, view: b.view ?? 'interactive' }) };
    },

    'POST /api/terminal/close': async ({ json }) => {
      sessions.close(sessionId(await json<Record<string, unknown>>()));
      return { ok: true };
    },

    'POST /api/terminal/label': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      if (typeof b.label !== 'string') throw badRequest();
      sessions.setLabel(sessionId(b), b.label);
      return { ok: true };
    },

    'GET /api/terminal/sessions': () => sessions.list(),

    'GET /api/terminal/commands': ({ query }) => sessions.commands(querySession(query)),
    'GET /api/terminal/command-output': ({ query }) => {
      const id = Number(query.get('id'));
      if (!Number.isInteger(id)) throw badRequest();
      const out = sessions.commandOutput(querySession(query), id);
      if (!out) throw notFound('terminalCommand', 'That command is no longer in the terminal.');
      return out;
    },
    'GET /api/terminal/results': ({ query }) => sessions.results(querySession(query)),
    'GET /api/terminal/captures': ({ query }) => sessions.captures(querySession(query)),
    'GET /api/terminal/earlier': ({ query }) => {
      const q = query.get('q') ?? '';
      if (q.length > 1000) throw badRequest();
      return sessions.earlier(querySession(query), q, { caseSensitive: query.get('case') === '1', regex: query.get('regex') === '1' });
    },
    'GET /api/terminal/alerts': ({ query }) => sessions.alerts(querySession(query)),
    'POST /api/terminal/alerts': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const patch: Record<string, boolean> = {};
      for (const k of ['finish', 'quiet', 'print']) {
        if (b[k] === undefined) continue;
        if (typeof b[k] !== 'boolean') throw badRequest();
        patch[k] = b[k] as boolean;
      }
      return sessions.setAlerts(sessionId(b), patch);
    },
    'GET /api/terminal/history': ({ query }) =>
      sessions.history.list({ query: (query.get('q') ?? '').slice(0, 500), failed: query.get('failed') === '1' }),
    'POST /api/terminal/history/clear': () => {
      sessions.history.clear();
      return { ok: true };
    },
    'POST /api/terminal/resolve-paths': async ({ json }) => {
      const b = await json<Record<string, unknown>>();
      const id = sessionId(b);
      if (!Array.isArray(b.paths) || b.paths.length > MAX_RESOLVE || !b.paths.every((p) => typeof p === 'string')) throw badRequest();
      const session = sessions.get(id);
      if (!session) throw notFound('terminalSession', 'No such terminal session');
      const kind = (p: string) => {
        try {
          return statSync(p).isDirectory() ? ('dir' as const) : ('file' as const);
        } catch {
          return null;
        }
      };
      return (b.paths as string[]).map((p) => resolveTerminalPath(p, session.cwd, lookup.platform, kind));
    },
    'GET /api/terminal/shells': () => availableShells(lookup),
    'GET /api/terminal/profiles': () => listProfiles(),
    'GET /api/terminal/launchers': () => opts.launchers?.list() ?? [],
  };

  const sinks = new WeakMap<ServerWebSocket<SocketData>, { session: string; sink: Sink }>();

  const sockets: SocketRoutes = {
    [TERMINAL_SOCKET_PATH]: {
      tickets,
      open(ws, { session, view }: Ticket) {
        const sink: Sink = {
          send(frame) {
            if (ws.getBufferedAmount() > MAX_BUFFERED) {
              sessions.detach(session, sink);
              ws.close(BACKPRESSURE_CLOSE, 'backpressure');
              return;
            }
            ws.send(frame);
          },
          close: () => ws.close(),
        };
        sinks.set(ws, { session, sink });
        try {
          sessions.attach(session, sink, view);
        } catch (e) {
          sinks.delete(ws);
          if (!(e instanceof AppError) || e.code !== 'terminalSession') {
            console.error('terminal attach failed', e);
            ws.close(1011, 'error');
            return;
          }
          ws.close(1008, 'noSession');
        }
      },
      message(ws, msg) {
        const attached = sinks.get(ws);
        if (!attached) return;
        const decoded = decodeClientMessage(msg);
        if (!decoded) return;
        if (decoded.kind === 'input') sessions.write(attached.session, attached.sink, decoded.data);
        else if (decoded.msg.type === 'resize') sessions.resize(attached.session, attached.sink, decoded.msg.cols, decoded.msg.rows);
        else if (decoded.msg.type === 'clear') sessions.clear(attached.session, attached.sink);
        else if (decoded.msg.type === 'visible') sessions.setVisible(attached.session, attached.sink, decoded.msg.visible);
        else sessions.close(attached.session, attached.sink);
      },
      close(ws) {
        const attached = sinks.get(ws);
        if (!attached) return;
        sinks.delete(ws);
        sessions.detach(attached.session, attached.sink);
      },
    },
  };

  return { routes, sockets };
}
