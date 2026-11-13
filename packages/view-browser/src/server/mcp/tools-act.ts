import type { CdpSession } from '@kedalion/cdp';
import { type Candidate, describeCandidates, isRef, matchCandidates } from './candidates.ts';
import { diffTexts, formatEffect } from './effects.ts';
import { PAGE_LIB } from './page-lib.ts';
import { bool, num, pageSession, resolveTab, runtimeEval, str } from './page-util.ts';
import { getTarget, loadTargets, removeTarget, type SavedTarget, setTarget, targetsFile } from './targets.ts';
import { failResult, type McpTool, textResult, type ToolArgs, type ToolContext, type ToolProp, type ToolSchema } from './types.ts';

const TAB: ToolProp = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' };
const LOCATE: Record<string, ToolProp> = {
  ref: { type: 'string', description: 'Ref (e1..) from browser_snapshot; valid until the next snapshot or navigation.' },
  selector: { type: 'string', description: 'CSS selector.' },
  target: { type: 'string', description: 'Name saved with browser_target for this site.' },
  timeoutMs: { type: 'integer', description: 'Wait for the element to be actionable, default 5000.' },
};
const schema = (properties: Record<string, ToolProp>, required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `expr` with `kd` (the in-page library) in scope and returns its value. */
async function page(session: CdpSession, expr: string): Promise<any> {
  const r = await runtimeEval(session, `(async () => { const kd = ${PAGE_LIB}; const v = await (${expr}); return v === undefined ? 'null' : JSON.stringify(v); })()`, { returnByValue: true, awaitPromise: true });
  if (!r.ok) throw new Error(r.text);
  const raw = r.value && typeof r.value === 'object' && 'value' in r.value ? (r.value as { value: unknown }).value : r.value;
  return JSON.parse(String(raw));
}

interface Locator {
  ref?: string;
  selector?: string;
  text?: string;
  label?: string;
}

async function locatorOf(session: CdpSession, ctx: ToolContext, a: ToolArgs, textKey: 'text' | null): Promise<Locator> {
  const loc: Locator = { ref: str(a, 'ref'), selector: str(a, 'selector'), label: str(a, 'label') };
  if (textKey) loc.text = str(a, textKey);
  const name = str(a, 'target');
  if (name) {
    const origin = (await page(session, 'location.origin')) as string;
    const t = getTarget(targetsFile(ctx.dataDir), origin, name);
    if (!t) throw new Error(`No saved target "${name}" for ${origin}. Use browser_target list.`);
    if (!loc.ref && !loc.selector && !loc.text && !loc.label) Object.assign(loc, t);
  }
  return loc;
}

type Kind = 'click' | 'field' | 'text';

/** Resolves the locator to a ref; an ambiguous or missing match throws with the candidates. */
async function resolve(session: CdpSession, loc: Locator, kind: Kind, exclude?: string): Promise<string> {
  if (loc.ref) {
    if (!isRef(loc.ref)) throw new Error(`Bad ref "${loc.ref}"; refs look like e12.`);
    if (!(await page(session, `!!kd.byRef(${JSON.stringify(loc.ref)})`))) throw new Error(`Unknown ref ${loc.ref}: refs are reset by browser_snapshot and navigation. Take a new snapshot.`);
    return loc.ref;
  }
  if (loc.selector) {
    const r = (await page(session, `kd.findSelector(${JSON.stringify(loc.selector)})`)) as { ref?: string; error?: string };
    if (!r.ref) throw new Error(r.error ?? 'No match');
    return r.ref;
  }
  const query = loc.label ?? loc.text;
  if (!query) throw new Error('Pass ref, selector, text/label or target.');
  const tries: Kind[] = kind === 'click' ? ['click', 'text'] : [kind];
  for (const k of tries) {
    const cands = (await page(session, `kd.cands(${JSON.stringify(k)}, null, ${JSON.stringify(exclude ?? null)})`)) as Candidate[];
    const m = matchCandidates(cands, query);
    if (!m.hits.length) continue;
    // An icon link and a text link to the same page (wiki item lists) are one target, not an ambiguity.
    const sameLink = m.hits.length > 1 && m.hits.length <= 8 && kind === 'click' && (await page(session, `kd.sameLink(${JSON.stringify(m.hits.map((c) => c.i))})`));
    if (sameLink) return ((await page(session, `kd.refs([${m.hits[0]!.i}])`)) as string[])[0]!;
    if (m.hits.length > 1 && !(exclude && k === 'text')) {
      const refs = (await page(session, `kd.refs(${JSON.stringify(m.hits.slice(0, 8).map((c) => c.i))})`)) as string[];
      throw new Error(`"${query}" is ambiguous (${m.hits.length} ${m.tier} matches); pass a ref:\n${describeCandidates(m.hits, refs)}`);
    }
    const hit = m.hits[m.hits.length - 1]!;
    return ((await page(session, `kd.refs([${hit.i}])`)) as string[])[0]!;
  }
  throw new Error(`No visible ${kind === 'field' ? 'field' : 'element'} matches "${query}". Use browser_snapshot to see what is on the page.`);
}

class GoneError extends Error {}

/** Like `actionable`, but when the page replaced the element (SmartGWT redraws), finds it again from the locator. */
async function actionableFor(session: CdpSession, loc: Locator, kind: Kind, ref: string, timeoutMs: number): Promise<{ ref: string; p: { x: number; y: number } }> {
  let cur = ref;
  for (let i = 0; ; i++) {
    try {
      return { ref: cur, p: await actionable(session, cur, timeoutMs) };
    } catch (e) {
      if (!(e instanceof GoneError) || loc.ref || i >= 3) throw e;
      await sleep(250);
      cur = await resolve(session, loc, kind);
    }
  }
}

/** Waits until the element is visible, uncovered and still across two frames; returns its click point. */
async function actionable(session: CdpSession, ref: string, timeoutMs: number): Promise<{ x: number; y: number }> {
  const deadline = Date.now() + timeoutMs;
  let reason = 'not ready';
  for (;;) {
    const p = (await page(session, `kd.probe(${JSON.stringify(ref)})`)) as { ok?: boolean; gone?: boolean; reason?: string; x: number; y: number };
    if (p.gone) throw new GoneError(`Element ${ref} is no longer in the page`);
    if (p.ok) return { x: p.x, y: p.y };
    reason = p.reason ?? reason;
    if (Date.now() >= deadline) break;
    await sleep(100);
  }
  const info = (await page(session, `kd.info(${JSON.stringify(ref)})`)) as { desc: string } | null;
  throw new Error(`${info?.desc ?? ref} is ${reason} (waited ${timeoutMs}ms)`);
}

async function mouseClick(session: CdpSession, p: { x: number; y: number }): Promise<void> {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
}

const lastId = (list: Array<{ id: number }>) => list.reduce((m, e) => Math.max(m, e.id), 0);

/** Runs `action`, then reports what changed on the page, the network and the console. */
async function withEffect(session: CdpSession, tab: string, ctx: ToolContext, action: () => Promise<string>): Promise<string> {
  const logs = ctx.service.logs(tab);
  const texts = async () => ((await page(session, 'kd.texts()').catch(() => [])) as string[]);
  const before = await texts();
  const net0 = logs ? lastId(logs.network.entries()) : 0;
  const con0 = logs ? lastId(logs.console.entries()) : 0;
  const head = await action();
  await sleep(350);
  const after = await texts();
  const focus = ((await page(session, 'kd.focusInfo()').catch(() => '')) as string) || '';
  const requests = logs ? logs.network.entries().filter((e) => e.id > net0).length : 0;
  const errors = logs ? logs.console.entries().filter((e) => e.id > con0 && e.level === 'error').map((e) => e.text) : [];
  return `${head}\n${formatEffect({ focus, diff: diffTexts(before, after), requests, errors })}`;
}

const guard = (fn: McpTool['run']): McpTool['run'] => async (a, ctx) => {
  try {
    return await fn(a, ctx);
  } catch (e) {
    return failResult(e instanceof Error ? e.message : String(e));
  }
};

const timeoutOf = (a: ToolArgs) => Math.min(Math.max(num(a, 'timeoutMs') ?? 5000, 100), 60_000);
const nameOf = async (session: CdpSession, ref: string) => ((await page(session, `kd.info(${JSON.stringify(ref)})`)) as { desc: string } | null)?.desc ?? ref;

export const actTools: McpTool[] = [
  {
    name: 'browser_click',
    description:
      'Click an element by text (visible text, exact match preferred, else contains; also finds td/div/span buttons), ref (from browser_snapshot), selector, saved target, or a viewport point (x, y). Scrolls into view and waits until visible, uncovered and stable. An ambiguous text lists the candidates. Returns what changed. newTab=true opens a link in a new background tab instead (the current page stays) and returns the new tab id.',
    inputSchema: schema({
      ...LOCATE,
      text: { type: 'string', description: 'Visible text of the element.' },
      x: { type: 'number' },
      y: { type: 'number' },
      newTab: { type: 'boolean', description: 'Open the link in a new background tab instead of clicking.' },
    }),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const hasPoint = num(a, 'x') !== undefined && num(a, 'y') !== undefined;
      const loc = hasPoint ? {} : await locatorOf(session, ctx, a, 'text');
      if (!hasPoint && !loc.ref && !loc.selector && !loc.text && !loc.label) return failResult('Pass text, ref, selector, target, or both x and y.');
      if (bool(a, 'newTab')) {
        if (hasPoint) return failResult('newTab needs text, ref, selector or target, not x/y.');
        const ref = await resolve(session, loc, 'click');
        const href = (await page(session, `(() => { const el = kd.byRef(${JSON.stringify(ref)}); const l = el && (el.closest('a[href]') || el.querySelector('a[href]')); return l ? l.href : null; })()`)) as string | null;
        if (!href || href.startsWith('javascript:')) return failResult(`${await nameOf(session, ref)} is not a link; click it without newTab.`);
        const t = await ctx.service.open(href, { activate: false });
        return textResult(`Opened ${href} in background tab ${t.id} (pass tab=${t.id} to work in it)`);
      }
      return textResult(
        await withEffect(session, tab, ctx, async () => {
          if (hasPoint) {
            await mouseClick(session, { x: num(a, 'x')!, y: num(a, 'y')! });
            return `Clicked ${num(a, 'x')},${num(a, 'y')}`;
          }
          const { ref, p } = await actionableFor(session, loc, 'click', await resolve(session, loc, 'click'), timeoutOf(a));
          await mouseClick(session, p);
          return `Clicked ${ref} ${await nameOf(session, ref)}`;
        }),
      );
    }),
  },
  {
    name: 'browser_type',
    description: 'Focus a field (ref, selector, label, or saved target), replace its content with text, and optionally press Enter. label matches the <label>, placeholder, aria-label or the nearest preceding text. Returns what changed.',
    inputSchema: schema({ ...LOCATE, label: { type: 'string', description: 'Label of the field.' }, text: { type: 'string', description: 'Text to type.' }, submit: { type: 'boolean' } }, ['text']),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const loc = await locatorOf(session, ctx, a, null);
      if (!loc.ref && !loc.selector && !loc.label) return failResult('Pass ref, selector, label or target.');
      return textResult(
        await withEffect(session, tab, ctx, async () => {
          const { ref } = await actionableFor(session, loc, 'field', await resolve(session, loc, 'field'), timeoutOf(a));
          await page(session, `kd.focus(${JSON.stringify(ref)}, true)`);
          const text = String(a.text ?? '');
          if (text === '') await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
          else await session.send('Input.insertText', { text });
          if (bool(a, 'submit')) {
            await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
            await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          }
          return `Typed into ${ref} ${await nameOf(session, ref)}${bool(a, 'submit') ? ' and pressed Enter' : ''}`;
        }),
      );
    }),
  },
  {
    name: 'browser_fill',
    description: 'Focus a field (ref, selector, label or saved target), select all, replace it with value, fire input and change events, and return the final value.',
    inputSchema: schema({ ...LOCATE, label: { type: 'string', description: 'Label of the field.' }, value: { type: 'string' } }, ['value']),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const loc = await locatorOf(session, ctx, a, null);
      if (!loc.ref && !loc.selector && !loc.label) return failResult('Pass ref, selector, label or target.');
      const value = String(a.value ?? '');
      return textResult(
        await withEffect(session, tab, ctx, async () => {
          const { ref } = await actionableFor(session, loc, 'field', await resolve(session, loc, 'field'), timeoutOf(a));
          await page(session, `kd.focus(${JSON.stringify(ref)}, true)`);
          if (value === '') await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
          else await session.send('Input.insertText', { text: value });
          const final = (await page(session, `kd.finishInput(${JSON.stringify(ref)}, ${JSON.stringify(value)})`)) as string;
          return `Filled ${ref} ${await nameOf(session, ref)}; value now ${JSON.stringify(final)}`;
        }),
      );
    }),
  },
  {
    name: 'browser_select',
    description: 'Choose option (by text) in a dropdown found by label, ref, selector or saved target. Handles native <select> and custom dropdowns (opens them, including the focus-then-open double click). Returns the chosen value.',
    inputSchema: schema({ ...LOCATE, label: { type: 'string', description: 'Label of the dropdown.' }, option: { type: 'string', description: 'Text of the option.' } }, ['option']),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const loc = await locatorOf(session, ctx, a, null);
      if (!loc.ref && !loc.selector && !loc.label) return failResult('Pass ref, selector, label or target.');
      const option = String(a.option ?? '');
      const timeout = timeoutOf(a);
      return textResult(
        await withEffect(session, tab, ctx, async () => {
          const ref = await resolve(session, loc, 'field');
          const info = (await page(session, `kd.info(${JSON.stringify(ref)})`)) as { tag: string };
          if (info.tag === 'select') {
            const r = (await page(session, `kd.selectNative(${JSON.stringify(ref)}, ${JSON.stringify(option)})`)) as { value?: string; error?: string };
            if (r.error) throw new Error(r.error);
            return `Selected ${JSON.stringify(r.value)} in ${ref}`;
          }
          let optRef: string | undefined;
          let cur = ref;
          const sig = (c: Candidate) => `${c.tag}|${c.text}|${c.x}|${c.y}`;
          const baseline = new Set(((await page(session, `kd.cands('text', null, ${JSON.stringify(ref)})`)) as Candidate[]).filter((c) => matchCandidates([c], option).hits.length).map(sig));
          const findOption = async () => {
            const cands = ((await page(session, `kd.cands('text', null, ${JSON.stringify(cur)})`)) as Candidate[]).filter((c) => !baseline.has(sig(c)));
            const m = matchCandidates(cands, option);
            if (m.hits.length > 1 && m.tier !== 'exact') {
              const refs = (await page(session, `kd.refs(${JSON.stringify(m.hits.slice(0, 8).map((c) => c.i))})`)) as string[];
              throw new Error(`Option "${option}" is ambiguous (${m.hits.length} ${m.tier} matches); use the exact text:\n${describeCandidates(m.hits, refs)}`);
            }
            return m.hits.length ? ((await page(session, `kd.refs([${m.hits[m.hits.length - 1]!.i}])`)) as string[])[0] : undefined;
          };
          for (let attempt = 0; attempt < 3 && !optRef; attempt++) {
            if (attempt > 0 && !loc.ref) cur = await resolve(session, loc, 'field');
            const got = await actionableFor(session, loc, 'field', cur, timeout);
            cur = got.ref;
            const p = got.p;
            if (attempt < 2) await mouseClick(session, p);
            else {
              const edge = (await page(session, `(() => { const r = kd.byRef(${JSON.stringify(cur)}).getBoundingClientRect(); return { x: Math.round(r.right), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
              await mouseClick(session, { x: edge.x + 8, y: edge.y });
            }
            for (let k = 0; k < 6 && !optRef; k++) {
              await sleep(120);
              optRef = await findOption();
            }
          }
          if (!optRef) throw new Error(`Option "${option}" did not appear after opening ${cur}`);
          for (let i = 0; ; i++) {
            try {
              await mouseClick(session, await actionable(session, optRef, timeout));
              break;
            } catch (e) {
              if (!(e instanceof GoneError) || i >= 3) throw e;
              await sleep(150);
              optRef = (await findOption()) ?? optRef;
            }
          }
          await sleep(200);
          const value = (await page(session, `kd.valueOf(${JSON.stringify(cur)})`)) as string;
          if (!String(value).toLowerCase().includes(option.toLowerCase())) throw new Error(`Clicked "${option}" in ${cur} but the value is still ${JSON.stringify(value)}`);
          return `Selected in ${cur}; value now ${JSON.stringify(value)}`;
        }),
      );
    }),
  },
  {
    name: 'browser_expand',
    description: 'Expand a tree node by its text, ref or saved target (clicks its opener icon, or the node itself when it has none). Returns what changed.',
    inputSchema: schema({ ...LOCATE, text: { type: 'string', description: 'Text of the tree node.' } }),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const loc = await locatorOf(session, ctx, a, 'text');
      if (!loc.ref && !loc.selector && !loc.text && !loc.label) return failResult('Pass text, ref or target.');
      return textResult(
        await withEffect(session, tab, ctx, async () => {
          const ref = await resolve(session, loc, 'text');
          const op = (await page(session, `kd.opener(${JSON.stringify(ref)})`)) as { ref?: string; expanded?: boolean } | null;
          if (op?.expanded) return `${ref} is already expanded`;
          const clickRef = op?.ref ?? ref;
          await mouseClick(session, await actionable(session, clickRef, timeoutOf(a)));
          return `Expanded ${ref} ${await nameOf(session, ref)}`;
        }),
      );
    }),
  },
  {
    name: 'browser_target',
    description: 'Saved names for controls of one site (stored per origin in targets.json of the view data folder). set name with text, selector or label; list; remove. click, type, fill, select and expand accept target=<name>.',
    inputSchema: schema(
      {
        action: { type: 'string', enum: ['set', 'list', 'remove'] },
        name: { type: 'string' },
        text: { type: 'string' },
        selector: { type: 'string' },
        label: { type: 'string' },
        origin: { type: 'string', description: 'Default the origin of the tab; for list, "all" shows every origin.' },
      },
      ['action'],
    ),
    run: guard(async (a, ctx) => {
      const tab = await resolveTab(ctx, a);
      const file = targetsFile(ctx.dataDir);
      const action = str(a, 'action');
      const origin = str(a, 'origin') ?? ((await page(ctx.service.tabs().session(tab), 'location.origin')) as string);
      const name = str(a, 'name');
      if (action === 'list') {
        const store = loadTargets(file);
        const origins = origin === 'all' ? Object.keys(store) : [origin];
        const lines = origins.flatMap((o) => Object.entries(store[o] ?? {}).map(([n, t]) => `${o}  ${n}: ${JSON.stringify(t)}`));
        return textResult(lines.length ? lines.join('\n') : 'No saved targets.');
      }
      if (!name) return failResult('Pass name.');
      if (action === 'remove') return removeTarget(file, origin, name) ? textResult(`Removed ${name} (${origin})`) : failResult(`No target ${name} for ${origin}`);
      const t: SavedTarget = { ...(str(a, 'text') ? { text: str(a, 'text')! } : {}), ...(str(a, 'selector') ? { selector: str(a, 'selector')! } : {}), ...(str(a, 'label') ? { label: str(a, 'label')! } : {}) };
      if (!Object.keys(t).length) return failResult('Pass text, selector or label.');
      setTarget(file, origin, name, t);
      return textResult(`Saved ${name} for ${origin}: ${JSON.stringify(t)}`);
    }),
  },
];
