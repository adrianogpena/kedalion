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

export interface DebugState {
  /** Enables the Debugger domain on the tab the first time it is called for it. */
  enable(tab: string, session: CdpSession): Promise<void>;
  paused(tab: string): PausedState | undefined;
  breakpoints: Map<string, BreakpointInfo>;
}

export function createDebugState(): DebugState {
  const enabled = new Map<string, Promise<void>>();
  const paused = new Map<string, PausedState>();
  return {
    enable(tab, session) {
      let p = enabled.get(tab);
      if (!p) {
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
