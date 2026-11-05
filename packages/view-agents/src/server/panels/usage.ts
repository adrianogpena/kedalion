import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { invalid } from '@kedalion/server-core';
import { detectAccounts } from '../accounts.ts';
import { projectKey } from '../projects.ts';
import { localDayKey } from '../usage-history.ts';
import { createBreakdownReader, spendOf, summarize } from '../usage-breakdown.ts';
import type { PanelCtx, PanelRoutes } from './ctx.ts';

/** USD limits; an absent or 0 limit is off. */
export interface BudgetLimits {
  daily?: number;
  monthly?: number;
}

export interface Budgets {
  global: BudgetLimits;
  /** Per project, keyed by `projectKey(path)`. */
  projects: Record<string, BudgetLimits>;
  /** Alerts already shown: `<scope>|<daily|monthly>|<80|100>` -> the period ('YYYY-MM-DD' or 'YYYY-MM') it fired in. */
  fired: Record<string, string>;
}

export const emptyBudgets = (): Budgets => ({ global: {}, projects: {}, fired: {} });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function limitsOf(v: unknown): BudgetLimits | undefined {
  if (v === undefined) return {};
  if (!isObject(v)) return undefined;
  const out: BudgetLimits = {};
  for (const k of ['daily', 'monthly'] as const) {
    const n = v[k];
    if (n === undefined || n === null || n === 0) continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9) return undefined;
    out[k] = n;
  }
  return out;
}

/** The limits of a request body (`fired` is the server's own); undefined when malformed. */
export function parseBudgets(v: unknown): Omit<Budgets, 'fired'> | undefined {
  if (!isObject(v)) return undefined;
  const global = limitsOf(v.global);
  if (!global) return undefined;
  const projects: Record<string, BudgetLimits> = {};
  if (v.projects !== undefined) {
    if (!isObject(v.projects)) return undefined;
    for (const [k, lim] of Object.entries(v.projects)) {
      const l = limitsOf(lim);
      if (!l) return undefined;
      if (l.daily || l.monthly) projects[projectKey(k)] = l;
    }
  }
  return { global, projects };
}

export interface BudgetAlert {
  scope: string;
  kind: 'daily' | 'monthly';
  level: 80 | 100;
  spent: number;
  limit: number;
}

/** The 80 % / 100 % alerts not yet fired this period, and the budgets with them marked fired (only the highest level crossed per limit fires). */
export function dueAlerts(b: Budgets, spend: ReturnType<typeof spendOf>, now: number): { alerts: BudgetAlert[]; fired: Record<string, string> } {
  const periods = { daily: localDayKey(now), monthly: localDayKey(now).slice(0, 7) };
  const alerts: BudgetAlert[] = [];
  const fired: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.fired)) if (v === periods.daily || v === periods.monthly) fired[k] = v;
  const scopes: Array<[string, BudgetLimits, { day: number; month: number }]> = [['', b.global, { day: spend.day, month: spend.month }]];
  for (const [p, lim] of Object.entries(b.projects)) scopes.push([p, lim, spend.projects[p] ?? { day: 0, month: 0 }]);
  for (const [scope, lim, s] of scopes) {
    for (const kind of ['daily', 'monthly'] as const) {
      const limit = lim[kind];
      if (!limit) continue;
      const spent = kind === 'daily' ? s.day : s.month;
      const level = spent >= limit ? 100 : spent >= limit * 0.8 ? 80 : 0;
      if (!level) continue;
      let hit = false;
      for (const l of [80, 100] as const) {
        if (l > level) continue;
        const key = `${scope}|${kind}|${l}`;
        if (fired[key] === periods[kind]) continue;
        fired[key] = periods[kind];
        hit = true;
      }
      if (hit) alerts.push({ scope, kind, level, spent, limit });
    }
  }
  return { alerts, fired };
}

const fmt = (n: number) => `$${n.toFixed(2)}`;
const nameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

export const alertToast = (a: BudgetAlert): { title: string; body: string } => ({
  title: `${a.scope ? `${nameOf(a.scope)}: ` : ''}${a.kind} budget at ${a.level}%`,
  body: `${fmt(a.spent)} of ${fmt(a.limit)} ${a.kind}`,
});

/** Server routes of the usage panel: the priced breakdown and the budgets (file `<agentsDir>/budgets.json`). */
export const routes: PanelRoutes = (ctx: PanelCtx) => {
  const file = join(ctx.agentsDir, 'budgets.json');
  const reader = createBreakdownReader();
  const load = async (): Promise<Budgets> => {
    const raw = (await readJsonFile(file, isObject).catch(() => undefined)) as Record<string, unknown> | undefined;
    const parsed = raw ? parseBudgets(raw) : undefined;
    const fired = isObject(raw?.fired) ? Object.fromEntries(Object.entries(raw.fired).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
    return { ...(parsed ?? { global: {}, projects: {} }), fired };
  };
  const save = (b: Budgets) => writeJsonAtomic(file, { version: 1, ...b });
  /** Fires the alerts due now and remembers them. */
  const check = async (b: Budgets, records: ReturnType<typeof reader.read>, now: number, force = false) => {
    const { alerts, fired } = dueAlerts(b, spendOf(records, now, projectKey), now);
    const changed = force || alerts.length > 0 || Object.keys(fired).length !== Object.keys(b.fired).length;
    const next = { ...b, fired };
    if (changed) await save(next);
    for (const a of alerts) ctx.notify(alertToast(a));
    return next;
  };
  return {
    'GET /api/agents/usage/summary': async () => {
      const now = Date.now();
      const records = reader.read(detectAccounts(homedir()), now);
      const budgets = await check(await load(), records, now);
      const spend = spendOf(records, now, projectKey);
      const accounts = detectAccounts(homedir()).map((a) => ({ id: a.id, label: a.label, summary: summarize(records.filter((r) => r.account === a.id), now) }));
      return { summary: summarize(records, now), accounts, budgets: { global: budgets.global, projects: budgets.projects }, spend };
    },
    'GET /api/agents/usage/budgets': async () => {
      const b = await load();
      return { global: b.global, projects: b.projects };
    },
    'PUT /api/agents/usage/budgets': async ({ json }) => {
      const parsed = parseBudgets(await json<unknown>());
      if (!parsed) throw invalid('budgets', 'Not a budget set');
      const now = Date.now();
      await check({ ...parsed, fired: (await load()).fired }, reader.read(detectAccounts(homedir()), now), now, true);
      return { ok: true };
    },
  };
};
