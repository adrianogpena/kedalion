import type { IMarker, Terminal } from '@xterm/headless';
import { createLineReader, detectResults, resultKey, type CompiledTrigger, type ScanState } from '../output-scan.ts';
import type { CaptureRecord, CommandRecord, ResultRecord } from '../protocol.ts';
import { parseOsc133, parseOsc633Command } from '../shell-integration.ts';

/** What the tracker reads from the settings (looked up on every line, so changes apply at once). */
export interface TrackerConfig {
  triggers: CompiledTrigger[];
  results: boolean;
}

export type TrackerEvent =
  | { type: 'commandStart'; record: CommandRecord }
  | { type: 'commandEnd'; record: CommandRecord }
  | { type: 'result'; record: ResultRecord }
  | { type: 'capture'; record: CaptureRecord; notify: boolean };

export interface Tracker {
  /** Shell integration: true while a command runs; undefined until the shell sent a mark. */
  running(): boolean | undefined;
  commands(): CommandRecord[];
  /** The output of a command still in the buffer; `truncated` when its first lines scrolled out. */
  output(id: number): { text: string; truncated: boolean } | null;
  results(): ResultRecord[];
  captures(): CaptureRecord[];
  /** Reads the lines the last chunk completed. */
  afterWrite(): void;
  dispose(): void;
}

export interface TrackerOptions {
  now: () => number;
  cwd: () => string;
  config: () => TrackerConfig;
  onEvent: (ev: TrackerEvent) => void;
}

const MAX_COMMANDS = 500;
const MAX_RESULTS = 50;
const MAX_CAPTURES = 300;
const MAX_COMMAND = 2000;
const MAX_OUTPUT_ROWS = 20_000;

interface Cmd {
  record: CommandRecord;
  start?: IMarker;
  end?: IMarker;
  /** Column of the cursor at D: the end row holds output only up to it (the next prompt follows). */
  endCol?: number;
}

/**
 * Follows a session's shell integration marks on its headless terminal: each command (OSC 633 E gives its line,
 * else the text typed after the prompt), its output range and exit code; and reads each output line once for
 * results and triggers.
 */
export function createTracker(term: Terminal, o: TrackerOptions): Tracker {
  const cmds: Cmd[] = [];
  const results: ResultRecord[] = [];
  const captures: CaptureRecord[] = [];
  const scan: ScanState = {};
  let nextId = 1;
  let pending: string | null = null;
  let promptEnd: { marker: IMarker; col: number } | undefined;
  let current: Cmd | undefined;
  let integrated = false;
  let running: boolean | undefined;

  const normal = () => term.buffer.normal;
  const cursorRow = () => normal().baseY + normal().cursorY;
  const mark = () => (term.buffer.active.type === 'normal' ? term.registerMarker(0) : undefined);

  const onLine = (text: string) => {
    const cfg = o.config();
    if (cfg.results) {
      for (const found of detectResults(text, scan)) {
        const key = resultKey(found);
        const old = results.findIndex((r) => resultKey(r) === key);
        if (old >= 0) results.splice(old, 1);
        const record: ResultRecord = { ...found, id: nextId++, at: o.now(), ...(current ? { command: current.record.command } : {}) };
        results.unshift(record);
        if (results.length > MAX_RESULTS) results.length = MAX_RESULTS;
        o.onEvent({ type: 'result', record });
      }
    }
    for (const { trigger, re } of cfg.triggers) {
      if (trigger.action === 'highlight') continue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      const record: CaptureRecord = { id: nextId++, at: o.now(), text: text.trim().slice(0, MAX_COMMAND), trigger: trigger.name || trigger.pattern };
      captures.unshift(record);
      if (captures.length > MAX_CAPTURES) captures.length = MAX_CAPTURES;
      o.onEvent({ type: 'capture', record, notify: trigger.action === 'notify' });
    }
  };
  const reader = createLineReader(term, onLine);

  /** The text typed after the prompt: C comes after the Enter's newline, so it ends on the row above the cursor. */
  const typedCommand = (): string => {
    const p = promptEnd;
    if (!p || p.marker.isDisposed) return '';
    const buf = normal();
    const end = cursorRow();
    const last = end > p.marker.line ? end - 1 : end;
    let text = '';
    for (let y = p.marker.line; y <= last && y - p.marker.line < 50; y++) {
      const line = buf.getLine(y);
      if (!line) break;
      if (y > p.marker.line && !line.isWrapped) text += '\n';
      text += line.translateToString(true, y === p.marker.line ? p.col : 0, y === end ? buf.cursorX : undefined);
    }
    return text.trim();
  };

  const finish = (code: number | null) => {
    const c = current;
    current = undefined;
    if (!c || c.record.endedAt !== undefined) return;
    c.record.endedAt = o.now();
    c.record.exitCode = code;
    c.end = mark();
    c.endCol = normal().cursorX;
    o.onEvent({ type: 'commandEnd', record: { ...c.record } });
  };

  const subs = [
    term.parser.registerOscHandler(633, (data) => {
      const command = parseOsc633Command(data);
      if (command !== null) pending = command.slice(0, MAX_COMMAND);
      return true;
    }),
    term.parser.registerOscHandler(133, (data) => {
      const m = parseOsc133(data);
      if (!m) return true;
      integrated = true;
      if (m.kind === 'A') {
        reader.read(running === true);
        if (current) finish(null);
        running = false;
      } else if (m.kind === 'B') {
        promptEnd?.marker.dispose();
        const marker = mark();
        promptEnd = marker ? { marker, col: normal().cursorX } : undefined;
      } else if (m.kind === 'C') {
        const command = (pending ?? typedCommand()).slice(0, MAX_COMMAND);
        pending = null;
        reader.skipToCursor();
        running = true;
        if (current) finish(null);
        if (command) {
          const c: Cmd = { record: { id: nextId++, command, cwd: o.cwd(), startedAt: o.now() }, start: mark() };
          cmds.push(c);
          if (cmds.length > MAX_COMMANDS) {
            const dropped = cmds.shift()!;
            dropped.start?.dispose();
            dropped.end?.dispose();
          }
          current = c;
          o.onEvent({ type: 'commandStart', record: { ...c.record } });
        }
      } else {
        reader.read(true);
        running = false;
        finish(m.code);
      }
      return true;
    }),
  ];

  const output = (id: number) => {
    const c = cmds.find((x) => x.record.id === id);
    if (!c?.start) return null;
    if (c.end?.isDisposed) return { text: '', truncated: true };
    const buf = normal();
    const truncated = c.start.isDisposed;
    const from = truncated ? 0 : c.start.line;
    const to = Math.min(c.end ? c.end.line : cursorRow(), from + MAX_OUTPUT_ROWS);
    const lines: string[] = [];
    for (let y = from; y <= to; y++) {
      const line = buf.getLine(y);
      if (!line) break;
      const text = line.translateToString(true, 0, c.end && y === to ? c.endCol : undefined);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return { text: lines.join('\n'), truncated };
  };

  return {
    running: () => running,
    commands: () => cmds.map((c) => ({ ...c.record })),
    output,
    results: () => [...results],
    captures: () => [...captures],
    afterWrite: () => reader.read(!integrated || running === true),
    dispose: () => {
      for (const s of subs) s.dispose();
      reader.dispose();
      promptEnd?.marker.dispose();
      for (const c of cmds) {
        c.start?.dispose();
        c.end?.dispose();
      }
    },
  };
}
