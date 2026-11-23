import type { CdpSession } from '@kedalion/cdp';
import type { ToolArgs, ToolContext, ToolProp } from './types.ts';

export const EVAL_TIMEOUT_MS = 10_000;
export const PAUSED_MESSAGE = 'page is paused at a breakpoint; use browser_debugger_eval or browser_debugger_step';

export const str = (a: ToolArgs, key: string): string | undefined => (typeof a[key] === 'string' && a[key] ? (a[key] as string) : undefined);
export const num = (a: ToolArgs, key: string): number | undefined => (typeof a[key] === 'number' ? (a[key] as number) : undefined);
export const bool = (a: ToolArgs, key: string): boolean => a[key] === true;

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** The tab to act on (the `tab` argument, else the active one); starts the browser when needed. */
export async function resolveTab(ctx: ToolContext, args: ToolArgs): Promise<string> {
  await ctx.ready();
  const wanted = str(args, 'tab');
  const tabs = ctx.service.tabs().list();
  if (wanted) {
    if (!tabs.some((t) => t.id === wanted)) throw new Error(`Unknown tab: ${wanted}. Use browser_tabs to list the tabs.`);
    ctx.service.touch(wanted);
    return wanted;
  }
  const active = ctx.service.activeTab();
  if (!active) throw new Error('No tab is open. Use browser_open to open one.');
  ctx.service.touch(active);
  return active;
}

export const FRAME: ToolProp = {
  type: 'string',
  description: 'Read inside a cross-origin iframe of the tab instead of the page: its number (1, 2, ..., see browser_tabs frames=true) or part of its URL.',
};

/** Short label of an iframe address: host prefix and last path segment without the long `_ctx_` token, e.g. `1449cqy…/test-library-1`. */
export function shortFrameUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter((x) => x && !x.startsWith('_ctx_'));
    const host = u.host.split('.')[0]!.split('-')[0]!;
    return `${host.slice(0, 10)}…/${seg.at(-1) ?? ''}${u.hash ? u.hash.slice(0, 30) : ''}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 59)}…` : url;
  }
}

/** A value of `value` at a JSON path like `$.a.b[0].c`; undefined when absent. */
export function jsonPick(value: unknown, path: string): unknown {
  const parts = [...path.replace(/^\$\.?/, '').matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]!));
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

/** The cross-origin iframe of `tab` named by `ref` (1-based number or URL part). */
export function resolveFrame(ctx: ToolContext, tab: string, ref: string): { id: string; url: string } {
  const frames = ctx.service.tabs().frames(tab);
  const list = frames.length ? frames.map((f, i) => `${i + 1}. ${shortFrameUrl(f.url)}`).join('\n') : 'none';
  const byNumber = /^\d+$/.test(ref) ? frames[Number(ref) - 1] : undefined;
  const hits = byNumber ? [byNumber] : frames.filter((f) => f.url.toLowerCase().includes(ref.toLowerCase()));
  if (hits.length !== 1) throw new Error(`${hits.length ? 'Several iframes match' : 'No iframe matches'} "${ref}". Cross-origin iframes of tab ${tab}:\n${list}`);
  return hits[0]!;
}

/** A page tab ready for a Runtime call (inside the iframe given as `frame`): throws while the page is paused at a breakpoint. */
export async function pageSession(ctx: ToolContext, args: ToolArgs): Promise<{ tab: string; session: CdpSession }> {
  const tab = await resolveTab(ctx, args);
  if (ctx.debug.paused(tab)) throw new Error(PAUSED_MESSAGE);
  const frame = str(args, 'frame');
  if (frame) return { tab, session: ctx.service.tabs().frameSession(tab, resolveFrame(ctx, tab, frame).id) };
  return { tab, session: ctx.service.tabs().session(tab) };
}

export interface EvalOutcome {
  ok: boolean;
  text: string;
  value?: unknown;
}

/** Text of a `Runtime.evaluate` / `Debugger.evaluateOnCallFrame` reply. */
export function describeEval(r: any): EvalOutcome {
  if (r.exceptionDetails) return { ok: false, text: String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'Error') };
  const o = r.result ?? {};
  const text = o.value !== undefined ? (typeof o.value === 'string' ? o.value : JSON.stringify(o.value)) : (o.description ?? o.type ?? 'undefined');
  return { ok: true, text: String(text), value: o.value };
}

/** Runs `expression` in the page; a hung page (paused, busy) fails after `timeoutMs` instead of hanging. */
export async function runtimeEval(
  session: CdpSession,
  expression: string,
  o: { awaitPromise?: boolean; returnByValue?: boolean; timeoutMs?: number } = {},
): Promise<EvalOutcome> {
  const wait = o.awaitPromise ?? true;
  const byValue = o.returnByValue ?? false;
  const r = await withTimeout(
    (async () => {
      const first: any = await session.send('Runtime.evaluate', {
        expression,
        awaitPromise: wait,
        returnByValue: wait ? false : byValue,
        generatePreview: true,
        userGesture: true,
        replMode: true,
      });
      const res = first.result;
      if (!wait || first.exceptionDetails || !res) return first;
      if (res.subtype === 'promise' && res.objectId) {
        return session.send('Runtime.awaitPromise', { promiseObjectId: res.objectId, returnByValue: byValue, generatePreview: true });
      }
      if (byValue && res.objectId) {
        return session.send('Runtime.callFunctionOn', { objectId: res.objectId, functionDeclaration: 'function(){return this}', returnByValue: true });
      }
      return first;
    })(),
    o.timeoutMs ?? EVAL_TIMEOUT_MS,
    `The page did not answer within ${(o.timeoutMs ?? EVAL_TIMEOUT_MS) / 1000}s (it may be busy or paused at a breakpoint)`,
  );
  return describeEval(r);
}
