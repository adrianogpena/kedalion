import type { CdpSession } from '@kedalion/cdp';

export interface PausedState {
  reason: string;
  callFrames: any[];
  hitBreakpoints: string[];
}

export interface BreakpointInfo {
  id: string;
  tab: string;
  url: string;
  /** 1-based. */
  line: number;
  column?: number;
  condition?: string;
  logMessage?: string;
}

export interface ScriptInfo {
  scriptId: string;
  url: string;
  sourceMapURL?: string;
}

export interface DebugState {
  /** Enables the Debugger domain on the tab the first time it is called for it. */
  enable(tab: string, session: CdpSession): Promise<void>;
  paused(tab: string): PausedState | undefined;
  /** Scripts parsed since the Debugger domain was enabled on the tab. */
  scripts(tab: string): ScriptInfo[];
  breakpoints: Map<string, BreakpointInfo>;
}

const MAX_SCRIPTS = 5000;

export function createDebugState(): DebugState {
  const enabled = new Map<string, Promise<void>>();
  const paused = new Map<string, PausedState>();
  const scripts = new Map<string, Map<string, ScriptInfo>>();
  return {
    scripts: (tab) => [...(scripts.get(tab)?.values() ?? [])],
    enable(tab, session) {
      let p = enabled.get(tab);
      if (!p) {
        const known = new Map<string, ScriptInfo>();
        scripts.set(tab, known);
        session.on('Debugger.scriptParsed', (e) => {
          if (!e?.scriptId || known.size >= MAX_SCRIPTS) return;
          known.set(String(e.scriptId), { scriptId: String(e.scriptId), url: String(e.url ?? ''), ...(e.sourceMapURL ? { sourceMapURL: String(e.sourceMapURL) } : {}) });
        });
        session.on('Debugger.paused', (e) => paused.set(tab, { reason: String(e.reason ?? 'unknown'), callFrames: e.callFrames ?? [], hitBreakpoints: e.hitBreakpoints ?? [] }));
        session.on('Debugger.resumed', () => void paused.delete(tab));
        p = session.send('Debugger.enable').then(() => undefined);
        p.catch(() => enabled.delete(tab));
        enabled.set(tab, p);
      }
      return p;
    },
    paused: (tab) => paused.get(tab),
    breakpoints: new Map(),
  };
}

/** The CDP condition of a breakpoint: a logpoint logs and never pauses. */
export function breakpointCondition(condition?: string, logMessage?: string): string | undefined {
  if (!logMessage) return condition || undefined;
  const log = `(console.log(${logMessage}), false)`;
  return condition ? `(${condition}) && ${log}` : log;
}

/** Scripts whose URL or source map URL contains the text (case-insensitive); all when no text. */
export function filterScripts(list: ScriptInfo[], text?: string): ScriptInfo[] {
  const needle = text?.toLowerCase();
  return needle ? list.filter((s) => s.url.toLowerCase().includes(needle) || (s.sourceMapURL ?? '').toLowerCase().includes(needle)) : list;
}

/** The URL a breakpoint should bind to: an exact script URL, else the single script containing the text, else the text itself. */
export function resolveScriptUrl(list: ScriptInfo[], url: string): { url: string } | { error: string } {
  if (list.some((s) => s.url === url)) return { url };
  const urls = [...new Set(list.filter((s) => s.url && s.url.includes(url)).map((s) => s.url))];
  if (urls.length === 1) return { url: urls[0]! };
  if (urls.length > 1) return { error: `"${url}" matches ${urls.length} scripts; use a longer part of the URL:\n${urls.slice(0, 10).join('\n')}` };
  return { url };
}

export type TraceEvent = { name?: string; ph?: string; ts?: number; dur?: number; args?: any };

export interface TraceSummary {
  longTasks: Array<{ durMs: number; atMs: number }>;
  lcpMs?: number;
}

/** Top long tasks (over 50 ms) and the last LCP candidate of a trace; times are relative to the first event. */
export function summarizeTrace(events: TraceEvent[], top = 5): TraceSummary {
  let first = Infinity;
  let nav: number | undefined;
  let lcp: number | undefined;
  const tasks: Array<{ durMs: number; ts: number }> = [];
  for (const e of events) {
    if (typeof e.ts !== 'number' || !e.ts) continue;
    if (e.ts < first) first = e.ts;
    if (e.name === 'RunTask' && e.ph === 'X' && (e.dur ?? 0) > 50_000) tasks.push({ durMs: (e.dur as number) / 1000, ts: e.ts });
    else if (e.name === 'navigationStart') nav = e.ts;
    else if (e.name === 'largestContentfulPaint::Candidate' && (lcp === undefined || e.ts > lcp)) lcp = e.ts;
  }
  const base = nav ?? first;
  tasks.sort((a, b) => b.durMs - a.durMs);
  return {
    longTasks: tasks.slice(0, top).map((t) => ({ durMs: Math.round(t.durMs), atMs: Math.round((t.ts - first) / 1000) })),
    ...(lcp !== undefined && Number.isFinite(base) ? { lcpMs: Math.round((lcp - base) / 1000) } : {}),
  };
}

export function formatTraceSummary(s: TraceSummary): string {
  const lines = [s.longTasks.length ? 'Long tasks (>50 ms), longest first:' : 'No tasks over 50 ms.'];
  for (const t of s.longTasks) lines.push(`  ${t.durMs} ms at +${t.atMs} ms`);
  lines.push(s.lcpMs !== undefined ? `LCP: ${s.lcpMs} ms after navigation start` : 'LCP: not in the trace');
  return lines.join('\n');
}
