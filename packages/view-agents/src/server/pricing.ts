import type { AgentAccountUsage, AgentCost } from '../protocol.ts';
import { localDayKey } from './usage-history.ts';

/** USD per million tokens. Cache writes: 5-minute and 1-hour TTL. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** Token counts of one message; `cacheCreation` includes `cacheCreation1h` (the part written with the 1-hour TTL). */
export interface PricedTokens {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  cacheCreation1h?: number;
}

const price = (input: number, output: number): ModelPrice => ({ input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead: input * 0.1 });

/** Static price table, first match wins (matched against the id from `claude-` on, lower case). */
export const PRICES: ReadonlyArray<{ match: RegExp; price: ModelPrice }> = [
  { match: /^claude-(3-opus|opus-4(-1)?(-\d{8})?$)/, price: price(15, 75) },
  { match: /opus/, price: price(5, 25) },
  { match: /sonnet/, price: price(3, 15) },
  { match: /^claude-3-haiku/, price: price(0.25, 1.25) },
  { match: /^claude-3-5-haiku/, price: price(0.8, 4) },
  { match: /haiku/, price: price(1, 5) },
];

/** Price of a model id (`claude-opus-4-5-20251101`, also with a provider prefix such as `us.anthropic.`); undefined when unknown. */
export function priceOf(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  const at = id.indexOf('claude-');
  if (at < 0) return undefined;
  const key = id.slice(at);
  return PRICES.find((p) => p.match.test(key))?.price;
}

/** Estimated USD of one message's tokens; undefined for an unknown model. */
export function costOf(model: string | undefined, tokens: PricedTokens): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  const oneHour = Math.min(tokens.cacheCreation1h ?? 0, tokens.cacheCreation);
  return (tokens.input * p.input + tokens.output * p.output + (tokens.cacheCreation - oneHour) * p.cacheWrite5m + oneHour * p.cacheWrite1h + tokens.cacheRead * p.cacheRead) / 1e6;
}

/** Estimated USD of one message's tokens split by kind (cache writes at the 5-minute rate); undefined for an unknown model. */
export function costParts(model: string | undefined, tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }): { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  return { input: (tokens.input * p.input) / 1e6, output: (tokens.output * p.output) / 1e6, cacheRead: (tokens.cacheRead * p.cacheRead) / 1e6, cacheWrite: (tokens.cacheWrite * p.cacheWrite5m) / 1e6 };
}

/** Local day keys of today and yesterday, and the start of yesterday (ms). */
export function costDays(now: number): { today: string; yesterday: string; since: number } {
  const d = new Date(now);
  const since = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  return { today: localDayKey(now), yesterday: localDayKey(since), since };
}

/**
 * Adds today / yesterday cost to each account's usage. An account with cost but no rate-limit reading gets an entry of its own
 * (updatedAt 0, so the freshest-reading pick still prefers accounts with limits).
 */
export function withCost(
  accounts: AgentAccountUsage[],
  costs: Map<string, AgentCost>,
  accs: Array<{ id: string; label: string; email?: string }>,
  activeId?: string,
): AgentAccountUsage[] {
  const out = accounts.map((a) => (costs.has(a.account) ? { ...a, cost: costs.get(a.account) } : a));
  for (const acc of accs) {
    const cost = costs.get(acc.id);
    if (!cost || out.some((a) => a.account === acc.id)) continue;
    out.push({ account: acc.id, label: acc.label, ...(activeId !== undefined ? { active: acc.id === activeId } : {}), updatedAt: 0, ...(acc.email ? { email: acc.email } : {}), cost });
  }
  return out;
}
