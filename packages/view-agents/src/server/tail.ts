import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { ChatEvent } from '../chat-protocol.ts';
import { normalizeLine } from './chat/normalize.ts';

export type TailEvent = ChatEvent;

export const TAIL_BACKFILL_BYTES = 512 * 1024;
export const TAIL_MAX_EVENTS = 600;
const POLL_MS = 1000;
const ECHO_PREFIXES = ['<command-name>', '<command-message>', '<command-args>', '<local-command-', '<bash-input>', '<bash-stdout>', '<bash-stderr>'];

/** Transcript events of one jsonl line: user text (not slash-command echoes), assistant text, tool calls and results (no thinking). */
export function eventsOfLine(line: string): TailEvent[] {
  if (!line.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  return normalizeLine(raw).filter((e) => {
    if (e.type === 'user') return !ECHO_PREFIXES.some((p) => e.text.trimStart().startsWith(p));
    return e.type === 'text' || e.type === 'tool_use' || e.type === 'tool_result' || e.type === 'interrupted' || e.type === 'notice';
  });
}

export interface Tailer {
  events(): TailEvent[];
  stop(): void;
}

/** Backfills the last 512 KB of a jsonl, then follows appended bytes. `onEvents` gets the ring (last 600 events) whenever an event was added. */
export function createTailer(path: string, onEvents: (turns: TailEvent[]) => void, pollMs = POLL_MS): Tailer {
  let ring: TailEvent[] = [];
  let offset = 0;
  let carry: Buffer = Buffer.alloc(0);
  let started = false;
  let stopped = false;

  const poll = () => {
    if (stopped) return;
    let fd: number;
    try {
      fd = openSync(path, 'r');
    } catch {
      return;
    }
    try {
      const size = fstatSync(fd).size;
      let from = offset;
      let dropFirst = false;
      if (!started) {
        from = Math.max(0, size - TAIL_BACKFILL_BYTES);
        dropFirst = from > 0;
        ring = [];
        carry = Buffer.alloc(0);
      } else if (size < offset) {
        from = 0;
        ring = [];
        carry = Buffer.alloc(0);
      } else if (size === offset) return;
      const buf = Buffer.alloc(size - from);
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, from + got);
        if (n <= 0) break;
        got += n;
      }
      offset = from + got;
      let data = Buffer.concat([carry, buf.subarray(0, got)]);
      if (dropFirst) {
        const nl = data.indexOf(10);
        data = nl < 0 ? Buffer.alloc(0) : data.subarray(nl + 1);
      }
      const last = data.lastIndexOf(10);
      carry = last < 0 ? data : data.subarray(last + 1);
      const complete = last < 0 ? '' : data.subarray(0, last).toString('utf8');
      const added: TailEvent[] = [];
      for (const line of complete.split('\n')) added.push(...eventsOfLine(line));
      const first = !started;
      started = true;
      if (added.length) {
        ring = [...ring, ...added].slice(-TAIL_MAX_EVENTS);
        onEvents(ring);
      } else if (first) onEvents(ring);
    } finally {
      closeSync(fd);
    }
  };

  poll();
  const timer = setInterval(poll, pollMs);
  return {
    events: () => ring,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
