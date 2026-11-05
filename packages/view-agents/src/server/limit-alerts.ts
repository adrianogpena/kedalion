import type { AgentAccountUsage, AgentRateLimit } from '../protocol.ts';

export type LimitWindow = 'fiveHour' | 'sevenDay';

export interface LimitToast {
  title: string;
  body: string;
}

export interface LimitThresholds {
  fiveHour: number;
  sevenDay: number;
}

const NAME: Record<LimitWindow, string> = { fiveHour: '5h', sevenDay: '7d' };

/** `14:30`, or `Fri 14:30` when the reset is not today. */
export function resetText(resetsAt: number, now: number): string {
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date(now).toDateString() ? time : `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function limitToast(window: LimitWindow, limit: AgentRateLimit, who: string | undefined, now: number): LimitToast {
  const reset = limit.resetsAt ? `Resets at ${resetText(limit.resetsAt, now)}` : '';
  return { title: `${NAME[window]} limit at ${Math.round(limit.percent)}%`, body: [who, reset].filter(Boolean).join(' · ') };
}

/**
 * Toasts for the 5h and 7d windows of each account that turn red (reach the critical percent) since the
 * last observation. The first observation of a window only records it; a window back under the
 * critical percent (or reset) arms it again.
 */
export function createLimitWatch(now: () => number = Date.now) {
  const above = new Map<string, boolean>();
  return {
    observe(accounts: readonly AgentAccountUsage[], crit: LimitThresholds): LimitToast[] {
      const out: LimitToast[] = [];
      for (const acc of accounts) {
        for (const w of ['fiveHour', 'sevenDay'] as const) {
          const limit = acc[w];
          if (!limit) continue;
          const key = `${acc.account}|${w}`;
          const isAbove = limit.percent >= crit[w];
          if (above.get(key) === false && isAbove) out.push(limitToast(w, limit, acc.email || acc.label, now()));
          above.set(key, isAbove);
        }
      }
      return out;
    },
  };
}
