// What the Activity map shows, computed from a session's trace. Pure: no React, no clock of its own.
// The map idea (stations, worn spokes, route, clock hands, folded feed) is from lot-map (MIT, https://github.com/alexeyw/lot-map).
import { type AgentSubagentInfo, type AgentTraceArea, type AgentTraceStep, shortModel } from '../../../protocol';
import { entriesOf, foldEntries, type Entry } from '../../trajectory/model';

/** Stations clockwise from the top. */
export const STATIONS: readonly AgentTraceArea[] = ['you', 'model', 'skills', 'agents', 'shell', 'web', 'browser', 'files', 'memory'];

/** A route leg stays this long, then fades over `ROUTE_FADE_MS`. */
export const ROUTE_HOLD_MS = 40_000;
export const ROUTE_FADE_MS = 20_000;
const ROUTE_LEGS = 6;
export const FEED_ROWS = 16;

export interface StationState {
  /** Calls (or prompts / requests) so far. */
  count: number;
  /** Calls in flight now. */
  running: number;
  /** Start of the oldest call in flight. */
  since?: number;
  /** Failed calls since the last prompt. */
  errors: number;
}

export interface RouteLeg {
  from: AgentTraceArea;
  to: AgentTraceArea;
  ts: number;
  /** 1 while fresh, down to 0 as it fades; legs at 0 are left out. */
  opacity: number;
  /** Step index of the leg's end (a stable key). */
  key: number;
}

export interface FeedRow {
  entry: Entry;
  status: 'run' | 'ok' | 'err' | 'model';
  /** The station the row belongs to. */
  area: AgentTraceArea;
  label: string;
  /** Folded calls besides the one named. */
  more: number;
  ms?: number;
}

export interface Board {
  stations: Record<AgentTraceArea, StationState>;
  route: RouteLeg[];
  /** Subagents at work now. */
  agents: number;
  context?: number;
  model?: string;
  feed: FeedRow[];
  /** Index of the newest step, to tell new steps from old. */
  last: number;
}

const isPrompt = (s: AgentTraceStep) => s.kind === 'user' && !s.source && !s.sidechain;

/** The station of a step, or undefined for steps the map does not show (thinking, notices, system text). */
export function stationOf(s: AgentTraceStep): AgentTraceArea | undefined {
  if (s.kind === 'tool') return s.area ?? 'shell';
  if (isPrompt(s)) return 'you';
  if (s.kind === 'assistant') return 'model';
  return undefined;
}

/** The map's state at `now`. `live`: the session is working, so calls without a result are in flight (else they were cut off). */
export function boardOf(steps: AgentTraceStep[], now: number, live: boolean, infos: AgentSubagentInfo[] = []): Board {
  const stations = Object.fromEntries(STATIONS.map((a) => [a, { count: 0, running: 0, errors: 0 }])) as Record<AgentTraceArea, StationState>;
  const requests = new Set<string>();
  const ended = new Set(steps.flatMap((s) => (s.notice ? [s.notice.toolUseId] : [])));
  let agents = 0;
  let context: number | undefined;
  let model: string | undefined;
  for (const s of steps) {
    if (isPrompt(s)) {
      stations.you.count++;
      for (const a of STATIONS) stations[a].errors = 0;
      continue;
    }
    if (s.messageId && !s.sidechain && !requests.has(s.messageId)) {
      requests.add(s.messageId);
      stations.model.count++;
    }
    if (!s.sidechain && s.contextPercent !== undefined) context = s.contextPercent;
    if (!s.sidechain && s.model && s.model !== '<synthetic>') model = s.model;
    if (s.kind !== 'tool') continue;
    const st = stations[s.area ?? 'shell'];
    st.count++;
    if (s.error) st.errors++;
    const background = !!s.subagent?.background && !!s.toolUseId && !ended.has(s.toolUseId);
    if (live && (s.pending || background)) {
      st.running++;
      if (s.ts !== undefined) st.since = Math.min(st.since ?? s.ts, s.ts);
      const runId = s.subagent?.workflow?.runId;
      // A workflow run counts its agents at work, at least one while it runs.
      if (s.subagent) agents += runId ? Math.max(1, infos.filter((a) => a.runId === runId && a.status === 'running').length) : 1;
    }
  }
  return { stations, route: routeOf(steps, now), agents, ...(context !== undefined ? { context } : {}), ...(model ? { model } : {}), feed: feedOf(steps, live), last: steps.length - 1 };
}

/** The last legs of the main loop between stations, model steps left out, with their fade at `now`. */
export function routeOf(steps: AgentTraceStep[], now: number): RouteLeg[] {
  const stops: Array<{ area: AgentTraceArea; ts: number; i: number }> = [];
  steps.forEach((s, i) => {
    if (s.sidechain || s.ts === undefined) return;
    const area = stationOf(s);
    if (!area || area === 'model') return;
    if (stops[stops.length - 1]?.area === area) stops[stops.length - 1] = { area, ts: s.ts, i };
    else stops.push({ area, ts: s.ts, i });
  });
  const legs: RouteLeg[] = [];
  for (let k = Math.max(1, stops.length - ROUTE_LEGS); k < stops.length; k++) {
    const a = stops[k - 1]!;
    const b = stops[k]!;
    const age = now - b.ts;
    const opacity = age <= ROUTE_HOLD_MS ? 1 : Math.max(0, 1 - (age - ROUTE_HOLD_MS) / ROUTE_FADE_MS);
    if (opacity > 0) legs.push({ from: a.area, to: b.area, ts: b.ts, opacity, key: b.i });
  }
  return legs;
}

/** The newest rows first: prompts, replies that changed model, and tool calls, finished calls in a row in one area folded. */
export function feedOf(steps: AgentTraceStep[], live: boolean, max = FEED_ROWS): FeedRow[] {
  const shown = entriesOf(steps).filter(({ step: s }) => s.kind === 'tool' || isPrompt(s) || (s.kind === 'assistant' && !!s.modelFrom));
  const rows: FeedRow[] = [];
  const folded = foldEntries(shown);
  for (let k = folded.length - 1; k >= 0 && rows.length < max; k--) {
    const e = folded[k]!;
    const s = e.step;
    const status: FeedRow['status'] = s.modelFrom && s.kind === 'assistant' ? 'model' : s.error ? 'err' : s.pending && live ? 'run' : 'ok';
    const label = status === 'model' ? `${shortModel(s.modelFrom!)} → ${shortModel(s.model ?? '')}` : s.label;
    const ms = e.fold ? e.fold.ms : s.durationMs;
    rows.push({ entry: e, status, area: stationOf(s) ?? 'model', label, more: e.fold ? e.fold.members.length - 1 : 0, ...(ms !== undefined ? { ms } : {}) });
  }
  return rows;
}

/** Thickness and brightness of a spoke worn by `count` calls. */
export function wear(count: number): { width: number; opacity: number } {
  const w = Math.log2(1 + count);
  return { width: Math.min(7, 1 + w * 0.9), opacity: Math.min(0.85, 0.22 + w * 0.09) };
}
