import type { ChatEvent } from '../../chat-protocol.ts';
import type { StepFocus } from '../trajectory/model';

/** Adds a live event to the list: `delta`s of one message merge, a `text` replaces its `delta`s, thinking is dropped. */
export function applyEvent(events: ChatEvent[], ev: ChatEvent): ChatEvent[] {
  if (ev.type === 'thinking') return events;
  if (ev.type === 'delta') {
    const last = events[events.length - 1];
    if (last?.type === 'delta' && last.messageId === ev.messageId) {
      return [...events.slice(0, -1), { ...last, text: last.text + ev.text }];
    }
    return [...events, ev];
  }
  if (ev.type === 'text') {
    const kept = events.filter((e) => !(e.type === 'delta' && e.messageId === ev.messageId));
    return [...kept, ev];
  }
  return [...events, ev];
}

export type ToolResult = Extract<ChatEvent, { type: 'tool_result' }>;
export type TranscriptItem =
  | { kind: 'event'; event: Exclude<ChatEvent, { type: 'tool_use' | 'tool_result' | 'thinking' }> }
  | { kind: 'tool'; use: Extract<ChatEvent, { type: 'tool_use' }>; result?: ToolResult }
  | { kind: 'orphan'; result: ToolResult };

/** Pairs each `tool_use` with its `tool_result`; thinking is left out. */
export function transcriptItems(events: ChatEvent[]): TranscriptItem[] {
  const results = new Map<string, ToolResult>();
  const uses = new Set<string>();
  for (const e of events) {
    if (e.type === 'tool_result') results.set(e.toolUseId, e);
    else if (e.type === 'tool_use') uses.add(e.id);
  }
  const items: TranscriptItem[] = [];
  for (const e of events) {
    if (e.type === 'thinking') continue;
    if (e.type === 'tool_use') items.push({ kind: 'tool', use: e, result: results.get(e.id) });
    else if (e.type === 'tool_result') { if (!uses.has(e.toolUseId)) items.push({ kind: 'orphan', result: e }); }
    else items.push({ kind: 'event', event: e });
  }
  return items;
}

/** One-line summary of a tool input: the usual path/command/pattern field, else compact JSON. */
export function toolSummary(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'description', 'query']) {
      if (typeof o[k] === 'string') return o[k] as string;
    }
  }
  const s = JSON.stringify(input) ?? '';
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

/** Position in `items` of the step a trajectory "Show on session" points at; -1 when it is not there. */
export function focusIndex(items: TranscriptItem[], f: StepFocus | undefined): number {
  if (!f) return -1;
  if (f.toolUseId) return items.findIndex((it) => it.kind === 'tool' && it.use.id === f.toolUseId);
  if (!f.kind || f.text === undefined) return -1;
  let seen = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind !== 'event') continue;
    const ev = it.event;
    const text = f.kind === 'user' && ev.type === 'user' ? ev.text : f.kind === 'assistant' && ev.type === 'text' ? ev.text : undefined;
    if (text === undefined || text.trim() !== f.text) continue;
    if (seen === (f.nth ?? 0)) return i;
    seen++;
  }
  return -1;
}
