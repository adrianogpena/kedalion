import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { invalid, notFound } from '@kedalion/server-core';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import { compileTriggers, type CompiledTrigger, type TerminalTrigger } from '../output-scan.ts';
import type { CaptureRecord, CommandRecord, EarlierHit, HistoryEntry, ResultRecord, SessionInfo, TerminalAlerts } from '../protocol.ts';
import { createEarlier, type Earlier, type EarlierSearch } from './earlier.ts';
import { historyStore, type HistoryStore } from './history.ts';
import { spawnPty, type Pty } from './pty.ts';
import { createTracker, type Tracker } from './tracker.ts';

export type { SessionInfo };

export type ViewKind = 'interactive' | 'preview';

export interface Sink {
  send(frame: string | Uint8Array): void;
  close(): void;
}

export interface CreateOptions {
  cmd: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
  label: string;
  launcher?: string;
  meta?: Record<string, unknown>;
  profile?: string;
  shell?: string;
}

const MAX_CWD = 4096;

/** The local path of an OSC 7 `file://host/path` payload (Windows drive paths get backslashes), or null. */
export function cwdFromOsc7(data: string): string | null {
  if (!data.startsWith('file://') || data.length > MAX_CWD) return null;
  const rest = data.slice('file://'.length);
  const slash = rest.search(/[/\\]/);
  if (slash < 0) return null;
  let path = rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {}
  if (/^[/\\][A-Za-z]:/.test(path)) path = path.slice(1).replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(path)) path += '\\';
  return path && !path.includes('\0') ? path : null;
}

export interface Session {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt: number;
}

/** What the settings say about reading output (`configure`); missing fields keep their defaults. */
export interface SessionsConfig {
  triggers?: TerminalTrigger[];
  /** Look for results (pull requests, apps, commits) in output; default true. */
  detectResults?: boolean;
  /** Notify when a command that ran at least this many seconds ends unseen; 0 never; default 30. */
  notifyAfter?: number;
  /** Keep the lines that leave the scrollback, for search; default true. */
  earlierOutput?: boolean;
}

export interface TerminalSessions {
  create(opts: CreateOptions): Session;
  get(id: string): Session | undefined;
  list(): SessionInfo[];
  attach(id: string, sink: Sink, view: ViewKind): void;
  detach(id: string, sink: Sink): void;
  write(id: string, sink: Sink, data: string | Uint8Array): void;
  resize(id: string, sink: Sink, cols: number, rows: number): void;
  /** Drops the replay buffer's scrollback (the interactive view cleared its screen). */
  clear(id: string, sink: Sink): void;
  /** Whether the user sees the interactive view (its tab shown, the window focused). */
  setVisible(id: string, sink: Sink, visible: boolean): void;
  close(id: string, sink?: Sink): void;
  closeAll(): void;
  setLabel(id: string, label: string): void;
  setMeta(id: string, meta: Record<string, unknown> | undefined): void;
  /** The last `n` lines of the headless screen (read-only). */
  screenLines(id: string, n: number): string[];
  commands(id: string): CommandRecord[];
  commandOutput(id: string, command: number): { text: string; truncated: boolean } | null;
  results(id: string): ResultRecord[];
  captures(id: string): CaptureRecord[];
  alerts(id: string): TerminalAlerts;
  setAlerts(id: string, patch: Partial<TerminalAlerts>): TerminalAlerts;
  earlier(id: string, query: string, o?: EarlierSearch): { hits: EarlierHit[]; count: number };
  history: HistoryStore;
  configure(config: SessionsConfig): void;
}

/** A notification the store asks for (a long command ended, an alert or a trigger fired). */
export interface SessionNotice {
  title: string;
  body: string;
  session: string;
}

export interface TerminalSessionsOptions {
  spawn?: typeof spawnPty;
  max?: number;
  now?: () => number;
  /** Shows a notification (OS toast); without it nothing is shown. */
  notify?: (n: SessionNotice) => void;
  /** Folder of the earlier-output files (one per session, removed with it); none keeps no earlier output. */
  earlierDir?: string;
  /** The command history file; none keeps it in memory. */
  historyFile?: string;
}

const SCROLLBACK = 5000;
const MAX_LABEL = 80;
const MAX_TITLE = 256;
const MAX_META_BYTES = 4096;
/** Output this soon after "when it prints" was set is the shell's echo, not news. */
const PRINT_GRACE = 500;
const QUIET_AFTER = 30_000;
const QUIET_TICK = 2000;
const NOTICE_TEXT = 140;

interface Viewer {
  sink: Sink;
  view: ViewKind;
  ready: boolean;
  exitSent: boolean;
  visible: boolean;
}

interface Alerts extends TerminalAlerts {
  quietFrom: number;
  printFrom: number;
}

interface Entry extends Session {
  cwd: string;
  profile?: string;
  shell?: string;
  pty: Pty;
  term: Terminal;
  serializer: SerializeAddon;
  tracker: Tracker;
  earlier?: Earlier;
  alerts: Alerts;
  label: string;
  launcher?: string;
  meta?: Record<string, unknown>;
  cols: number;
  rows: number;
  exited: number | null | undefined;
  title: string;
  bells: number;
  lastOutputAt: number;
  viewers: Viewer[];
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

const control = (msg: Record<string, unknown>) => JSON.stringify(msg);

function checkMeta(meta: Record<string, unknown> | undefined): void {
  if (meta !== undefined && JSON.stringify(meta).length > MAX_META_BYTES) {
    throw invalid('terminalMeta', 'Session metadata is too large');
  }
}

/** `12s`, `3m 4s`, `1h 2m`. */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const short = (text: string) => (text.length > NOTICE_TEXT ? `${text.slice(0, NOTICE_TEXT - 1)}…` : text);

export function terminalSessions({ spawn = spawnPty, max = 20, now = Date.now, notify, earlierDir, historyFile }: TerminalSessionsOptions = {}): TerminalSessions {
  const entries = new Map<string, Entry>();
  const history = historyStore(historyFile);
  let triggers: CompiledTrigger[] = [];
  let detect = true;
  let notifyAfter = 30;
  let keepEarlier = true;
  let quietTimer: ReturnType<typeof setInterval> | undefined;
  // Sessions do not outlive the app: earlier output of a previous run has no terminal any more.
  if (earlierDir) rmSync(earlierDir, { recursive: true, force: true });

  const must = (id: string): Entry => {
    const e = entries.get(id);
    if (!e) throw notFound('terminalSession', 'No such terminal session');
    return e;
  };

  const interactive = (e: Entry) => e.viewers.find((v) => v.view === 'interactive');
  const seen = (e: Entry) => !!interactive(e)?.visible;
  const nameOf = (e: Entry) => e.title || e.label;

  function broadcast(e: Entry, frame: string | Uint8Array): void {
    for (const v of e.viewers) if (v.ready) v.sink.send(frame);
  }

  const publicAlerts = (a: Alerts): TerminalAlerts => ({ finish: a.finish, quiet: a.quiet, print: a.print });
  const alertsChanged = (e: Entry) => broadcast(e, control({ type: 'alerts', alerts: publicAlerts(e.alerts) }));
  const fire = (e: Entry, body: string) => notify?.({ title: nameOf(e), body: short(body), session: e.id });

  const tickQuiet = () => {
    const t = now();
    let any = false;
    for (const e of entries.values()) {
      if (!e.alerts.quiet) continue;
      any = true;
      if (e.lastOutputAt > e.alerts.quietFrom && t - e.lastOutputAt >= QUIET_AFTER) {
        e.alerts.quiet = false;
        fire(e, `Quiet for ${durationText(t - e.lastOutputAt)}`);
        alertsChanged(e);
      }
    }
    if (!any) {
      clearInterval(quietTimer);
      quietTimer = undefined;
    }
  };

  function create(opts: CreateOptions): Session {
    if (entries.size >= max) reapExited();
    if (entries.size >= max) throw invalid('terminalLimit', 'Too many terminal sessions', { max });
    checkMeta(opts.meta);
    const pty = spawn(opts.cmd, opts.cwd, opts.cols, opts.rows, opts.env);
    const term = new Terminal({ cols: opts.cols, rows: opts.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);
    const createdAt = now();
    const id = randomId();
    const e: Entry = {
      id,
      cwd: opts.cwd,
      createdAt,
      pty,
      term,
      serializer,
      tracker: undefined as unknown as Tracker,
      alerts: { finish: false, quiet: false, print: false, quietFrom: 0, printFrom: 0 },
      label: opts.label.slice(0, MAX_LABEL),
      launcher: opts.launcher,
      meta: opts.meta,
      profile: opts.profile,
      shell: opts.shell,
      cols: opts.cols,
      rows: opts.rows,
      exited: undefined,
      title: '',
      bells: 0,
      lastOutputAt: createdAt,
      viewers: [],
    };
    e.tracker = createTracker(term, {
      now,
      cwd: () => e.cwd,
      config: () => ({ triggers, results: detect }),
      onEvent: (ev) => {
        if (ev.type === 'commandStart') return broadcast(e, control({ type: 'command', record: ev.record }));
        if (ev.type === 'result') return broadcast(e, control({ type: 'result', record: ev.record }));
        if (ev.type === 'capture') {
          broadcast(e, control({ type: 'capture', record: ev.record }));
          if (ev.notify) fire(e, `${ev.record.trigger}: ${ev.record.text}`);
          return;
        }
        const r = ev.record;
        broadcast(e, control({ type: 'command', record: r }));
        const took = (r.endedAt ?? now()) - r.startedAt;
        history.add({ command: r.command, cwd: r.cwd, at: r.startedAt, durationMs: took, exitCode: r.exitCode ?? null, terminal: nameOf(e) });
        const status = r.exitCode === null || r.exitCode === undefined ? 'finished' : r.exitCode === 0 ? 'succeeded' : `failed (exit ${r.exitCode})`;
        const text = `${r.command} ${status} after ${durationText(took)}`;
        if (e.alerts.finish) {
          e.alerts.finish = false;
          fire(e, text);
          alertsChanged(e);
        } else if (notifyAfter > 0 && took >= notifyAfter * 1000 && !seen(e)) fire(e, text);
      },
    });
    if (earlierDir && keepEarlier) e.earlier = createEarlier(term, join(earlierDir, `${id}.txt`));
    entries.set(e.id, e);

    // The interactive client answers terminal queries itself; headless answers only when none is attached.
    term.onData((reply) => {
      if (!interactive(e) && e.exited === undefined) pty.write(reply);
    });
    term.onTitleChange((raw) => {
      const title = raw.slice(0, MAX_TITLE);
      e.title = title;
      broadcast(e, control({ type: 'title', title }));
    });
    term.onBell(() => {
      e.bells++;
    });
    // Shell integration: OSC 7 reports the cwd; OSC 133 and 633 go to the tracker.
    term.parser.registerOscHandler(7, (data) => {
      const cwd = cwdFromOsc7(data);
      if (cwd) e.cwd = cwd;
      return true;
    });
    if (e.earlier) {
      const earlier = e.earlier;
      term.onLineFeed(() => earlier.check());
      // Erase in Display of the screen (2) or the scrollback (3): what is there is about to go.
      term.parser.registerCsiHandler({ final: 'J' }, (params) => {
        const p = params[0];
        if (p === 2) earlier.flush('screen');
        else if (p === 3) earlier.flush('scrollback');
        return false;
      });
    }

    pty.onData((data) => {
      const chunk = data.slice();
      const t = now();
      e.lastOutputAt = t;
      if (e.alerts.print && t - e.alerts.printFrom > PRINT_GRACE) {
        e.alerts.print = false;
        fire(e, 'Printed new output');
        alertsChanged(e);
      }
      // Viewers get the bytes after the replay state has parsed them, so an attach never sees a gap.
      try {
        term.write(chunk, () => {
          e.tracker.afterWrite();
          e.earlier?.check();
          broadcast(e, chunk);
        });
      } catch {
        close(e.id);
      }
    });
    pty.onExit((code) => {
      if (e.exited !== undefined) return;
      e.exited = code;
      term.write('', () => {
        const frame = control({ type: 'exit', code });
        for (const v of e.viewers) {
          if (v.ready && !v.exitSent) v.sink.send(frame);
          v.exitSent = true;
        }
      });
    });
    return e;
  }

  function attach(id: string, sink: Sink, view: ViewKind): void {
    const e = must(id);
    if (view === 'interactive') {
      const prev = interactive(e);
      if (prev) {
        e.viewers = e.viewers.filter((v) => v !== prev);
        prev.sink.close();
      }
    }
    sink.send(control({ type: 'hello', session: e.id, cols: e.cols, rows: e.rows }));
    // Live output starts once every earlier chunk has been parsed: the replay then ends exactly where it begins.
    const viewer: Viewer = { sink, view, ready: false, exitSent: false, visible: view === 'interactive' };
    e.viewers.push(viewer);
    e.term.write('', () => {
      if (!e.viewers.includes(viewer)) return;
      sink.send(new TextEncoder().encode(e.serializer.serialize()));
      if (e.title) sink.send(control({ type: 'title', title: e.title }));
      sink.send(control({ type: 'alerts', alerts: publicAlerts(e.alerts) }));
      if (e.exited !== undefined) {
        sink.send(control({ type: 'exit', code: e.exited }));
        viewer.exitSent = true;
      }
      viewer.ready = true;
    });
  }

  function detach(id: string, sink: Sink): void {
    const e = entries.get(id);
    if (!e) return;
    e.viewers = e.viewers.filter((v) => v.sink !== sink);
    if (e.exited !== undefined && e.viewers.length === 0) close(id);
  }

  function reapExited(): void {
    for (const e of [...entries.values()]) if (e.exited !== undefined && e.viewers.length === 0) close(e.id);
  }

  const isInteractive = (e: Entry, sink: Sink) => interactive(e)?.sink === sink;

  function write(id: string, sink: Sink, data: string | Uint8Array): void {
    const e = entries.get(id);
    if (e && e.exited === undefined && isInteractive(e, sink)) e.pty.write(data);
  }

  function resize(id: string, sink: Sink, cols: number, rows: number): void {
    const e = entries.get(id);
    if (!e || e.exited !== undefined || !isInteractive(e, sink)) return;
    e.cols = cols;
    e.rows = rows;
    e.pty.resize(cols, rows);
    e.term.resize(cols, rows);
  }

  function clear(id: string, sink: Sink): void {
    const e = entries.get(id);
    if (!e || !isInteractive(e, sink)) return;
    // After the output already queued, like the view's own clear.
    e.term.write('', () => {
      e.earlier?.flush('screen');
      e.term.clear();
    });
  }

  function close(id: string, sink?: Sink): void {
    const e = entries.get(id);
    if (!e) return;
    if (sink && !isInteractive(e, sink)) return;
    entries.delete(id);
    if (e.exited === undefined) e.pty.kill();
    for (const v of e.viewers) v.sink.close();
    e.viewers = [];
    e.tracker.dispose();
    e.earlier?.dispose();
    e.term.dispose();
  }

  return {
    create,
    get: (id) => entries.get(id),
    list: () =>
      [...entries.values()].map((e) => ({
        id: e.id,
        label: e.label,
        launcher: e.launcher,
        meta: e.meta,
        cwd: e.cwd,
        profile: e.profile,
        shell: e.shell,
        running: e.tracker.running(),
        cols: e.cols,
        rows: e.rows,
        createdAt: e.createdAt,
        exited: e.exited,
        title: e.title,
        bells: e.bells,
        lastOutputAt: e.lastOutputAt,
        viewers: { interactive: !!interactive(e), previews: e.viewers.filter((v) => v.view === 'preview').length },
      })),
    attach,
    detach,
    write,
    resize,
    clear,
    setVisible(id, sink, visible) {
      const e = entries.get(id);
      const v = e && interactive(e);
      if (v && v.sink === sink) v.visible = visible;
    },
    close,
    closeAll: () => {
      for (const id of [...entries.keys()]) close(id);
      clearInterval(quietTimer);
      quietTimer = undefined;
      history.flush();
    },
    setLabel(id, label) {
      must(id).label = label.slice(0, MAX_LABEL);
    },
    screenLines(id, n) {
      const buf = must(id).term.buffer.active;
      const out: string[] = [];
      for (let y = Math.max(0, buf.length - n); y < buf.length; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '');
      return out;
    },
    setMeta(id, meta) {
      checkMeta(meta);
      must(id).meta = meta;
    },
    commands: (id) => must(id).tracker.commands(),
    commandOutput: (id, command) => must(id).tracker.output(command),
    results: (id) => must(id).tracker.results(),
    captures: (id) => must(id).tracker.captures(),
    alerts: (id) => publicAlerts(must(id).alerts),
    setAlerts(id, patch) {
      const e = must(id);
      const t = now();
      for (const key of ['finish', 'quiet', 'print'] as const) {
        const on = patch[key];
        if (on === undefined) continue;
        e.alerts[key] = on;
        if (on && key === 'quiet') e.alerts.quietFrom = t;
        if (on && key === 'print') e.alerts.printFrom = t;
      }
      if (e.alerts.quiet && !quietTimer) {
        quietTimer = setInterval(tickQuiet, QUIET_TICK);
        (quietTimer as { unref?: () => void }).unref?.();
      }
      alertsChanged(e);
      return publicAlerts(e.alerts);
    },
    earlier: (id, query, o) => must(id).earlier?.search(query, o) ?? { hits: [], count: 0 },
    history,
    configure(config) {
      triggers = compileTriggers(config.triggers);
      detect = config.detectResults ?? true;
      notifyAfter = config.notifyAfter ?? 30;
      keepEarlier = config.earlierOutput ?? true;
    },
  };
}

export type { HistoryEntry };
