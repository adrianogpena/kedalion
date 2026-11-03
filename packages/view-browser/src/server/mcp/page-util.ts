import type { CdpSession } from '@kedalion/cdp';
import type { ToolArgs, ToolContext } from './types.ts';

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
    return wanted;
  }
  const active = ctx.service.activeTab();
  if (!active) throw new Error('No tab is open. Use browser_open to open one.');
  return active;
}

/** A page tab ready for a Runtime call: throws while the page is paused at a breakpoint. */
export async function pageSession(ctx: ToolContext, args: ToolArgs): Promise<{ tab: string; session: CdpSession }> {
  const tab = await resolveTab(ctx, args);
  if (ctx.debug.paused(tab)) throw new Error(PAUSED_MESSAGE);
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
