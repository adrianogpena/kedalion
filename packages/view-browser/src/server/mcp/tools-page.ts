import { normalizeAddress } from '../../address.ts';
import { bool, num, pageSession, resolveTab, runtimeEval, str, withTimeout } from './page-util.ts';
import { DEFAULT_SNAPSHOT_CHARS, type PageSnapshot, renderSnapshot } from './snapshot.ts';
import { failResult, type McpTool, textResult, type ToolSchema } from './types.ts';

const TAB = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' } as const;
const schema = (properties: ToolSchema['properties'], required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});

const SNAPSHOT_SCRIPT = `(() => {
  const clean = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const css = (el) => { if (el.id) return '#' + CSS.escape(el.id); const n = el.getAttribute('name'); const t = el.tagName.toLowerCase(); return n ? t + '[name="' + n.replace(/"/g, '\\\\"') + '"]' : t; };
  const labelOf = (el) => clean(el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
  return {
    title: document.title,
    url: location.href,
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => ({ level: Number(h.tagName[1]), text: clean(h.textContent) })).filter((h) => h.text),
    links: [...document.querySelectorAll('a[href]')].filter(visible).map((a) => ({ text: clean(a.textContent || a.getAttribute('aria-label')), href: a.href })),
    fields: [...document.querySelectorAll('input,select,textarea,button')].filter(visible).map((f) => {
      const tag = f.tagName.toLowerCase();
      const type = f.getAttribute('type') || undefined;
      const isButton = tag === 'button' || type === 'submit' || type === 'button';
      return { tag, type, name: f.getAttribute('name') || undefined, label: isButton ? clean(f.textContent || f.value) : labelOf(f), value: isButton || type === 'password' ? undefined : String(f.value ?? ''), selector: css(f) };
    }),
    text: clean(document.body?.innerText),
  };
})()`;

/** Page center of the element (scrolled into view), or null. */
const centerScript = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

async function point(session: Parameters<typeof runtimeEval>[0], selector: string): Promise<{ x: number; y: number }> {
  const r = await runtimeEval(session, centerScript(selector), { returnByValue: true, awaitPromise: false });
  if (!r.ok) throw new Error(r.text);
  const p = r.value as { x: number; y: number } | null | undefined;
  if (!p) throw new Error(`No element matches ${selector}`);
  return p;
}

const tabLine = (t: { id: string; title: string; url: string; loading: boolean }, active: boolean) => `${active ? '*' : ' '} ${t.id}  ${t.title || '(untitled)'}  ${t.url}${t.loading ? '  (loading)' : ''}`;

export const pageTools: McpTool[] = [
  {
    name: 'browser_tabs',
    description: 'List the open tabs of the Browser view (the active one is marked with *). Starts the browser when it is not running.',
    inputSchema: { type: 'object', properties: {} },
    async run(_a, ctx) {
      await ctx.ready();
      const active = ctx.service.activeTab();
      const list = ctx.service.tabs().list();
      return textResult(list.length ? list.map((t) => tabLine(t, t.id === active)).join('\n') : 'No tabs are open.');
    },
  },
  {
    name: 'browser_open',
    description: 'Open a URL: in a new tab (newTab) or in the tab given (default the active tab; a new tab when none is open).',
    inputSchema: schema({ url: { type: 'string', description: 'Address; a bare host gets https://.' }, newTab: { type: 'boolean', description: 'Open in a new tab.' } }, ['url']),
    async run(a, ctx) {
      await ctx.ready();
      const url = normalizeAddress(str(a, 'url') ?? '');
      const wanted = str(a, 'tab');
      const target = wanted ?? ctx.service.activeTab();
      if (bool(a, 'newTab') || !target) {
        const t = await ctx.service.open(url);
        return textResult(`Opened ${t.url} in tab ${t.id}`);
      }
      const tab = await resolveTab(ctx, { tab: target });
      await ctx.service.navigate(tab, url);
      return textResult(`Navigating tab ${tab} to ${url}`);
    },
  },
  {
    name: 'browser_navigate',
    description: 'Go back, go forward, reload or stop loading.',
    inputSchema: schema({ action: { type: 'string', enum: ['back', 'forward', 'reload', 'stop'] } }, ['action']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      await ctx.service.action(tab, a.action as 'back' | 'forward' | 'reload' | 'stop');
      return textResult(`${a.action} done on tab ${tab}`);
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot of the page as a PNG: the viewport, the whole page (fullPage) or one element (selector).',
    inputSchema: schema({ fullPage: { type: 'boolean' }, selector: { type: 'string', description: 'CSS selector of one element.' } }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const params: Record<string, unknown> = { format: 'png' };
      const selector = str(a, 'selector');
      if (selector) {
        const r = await runtimeEval(
          session,
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`,
          { returnByValue: true, awaitPromise: false },
        );
        const box = r.value as { x: number; y: number; width: number; height: number } | null | undefined;
        if (!r.ok || !box) return failResult(r.ok ? `No element matches ${selector}` : r.text);
        params.clip = { ...box, scale: 1 };
        params.captureBeyondViewport = true;
      } else if (bool(a, 'fullPage')) {
        const m = await session.send('Page.getLayoutMetrics');
        const size = m.cssContentSize ?? m.contentSize;
        params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const shot = await withTimeout(session.send('Page.captureScreenshot', params), 15_000, 'The screenshot timed out');
      return { content: [{ type: 'image', data: String(shot.data), mimeType: 'image/png' }] };
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Text snapshot of the page: title, url, headings, form fields with values, links and visible text, pruned to maxChars.',
    inputSchema: schema({ maxChars: { type: 'integer', description: `Budget of the snapshot, default ${DEFAULT_SNAPSHOT_CHARS}.` } }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const r = await runtimeEval(session, SNAPSHOT_SCRIPT, { returnByValue: true, awaitPromise: false });
      if (!r.ok) return failResult(r.text);
      const max = Math.min(Math.max(num(a, 'maxChars') ?? DEFAULT_SNAPSHOT_CHARS, 200), 19_000);
      return textResult(renderSnapshot(r.value as PageSnapshot, max), 'Pass a smaller maxChars.');
    },
  },
  {
    name: 'browser_console',
    description: 'Console messages of the tab (newest last). Each line starts with its id; pass since=<id> for later messages.',
    inputSchema: schema({
      level: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
      since: { type: 'integer', description: 'Only messages with an id above this.' },
      limit: { type: 'integer', description: 'Newest N messages, default 50.' },
      text: { type: 'string', description: 'Only messages containing this text.' },
    }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const level = str(a, 'level') as 'log' | 'info' | 'warn' | 'error' | 'debug' | undefined;
      const text = str(a, 'text');
      const entries = logs.console.entries({
        ...(num(a, 'since') !== undefined ? { since: num(a, 'since')! } : {}),
        limit: num(a, 'limit') ?? 50,
        filter: { ...(level ? { level } : {}), ...(text ? { text } : {}) },
      });
      if (!entries.length) return textResult('No console messages.');
      const lines = entries.map((e) => `#${e.id} [${e.level}] ${e.text}${e.source ? `  (${e.source.url}:${e.source.line})` : ''}`);
      return textResult(lines.join('\n'), 'Pass a smaller limit, or since=<last id> for newer messages.');
    },
  },
  {
    name: 'browser_network',
    description: 'Network requests of the tab, oldest first. Each line starts with its id (for browser_network_detail).',
    inputSchema: schema({
      url: { type: 'string', description: 'Only URLs containing this text.' },
      status: { type: 'integer' },
      type: { type: 'string', description: 'Resource type, e.g. XHR, Fetch, Document, Script.' },
      failedOnly: { type: 'boolean' },
      limit: { type: 'integer', description: 'Default 50.' },
      offset: { type: 'integer', description: 'Skip this many matches, default 0.' },
    }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const url = str(a, 'url');
      const type = str(a, 'type');
      const all = logs.network.entries({
        filter: { ...(url ? { text: url } : {}), ...(type ? { type } : {}), ...(num(a, 'status') !== undefined ? { status: num(a, 'status')! } : {}), ...(bool(a, 'failedOnly') ? { failed: true } : {}) },
      });
      if (!all.length) return textResult('No matching requests.');
      const offset = Math.max(num(a, 'offset') ?? 0, 0);
      const limit = Math.max(num(a, 'limit') ?? 50, 1);
      const page = all.slice(offset, offset + limit);
      const lines = page.map((e) => `#${e.id} ${e.method} ${e.status ?? (e.failed ? 'FAILED' : '...')} ${e.type ?? ''} ${e.url}${e.failed ? `  (${e.failed})` : ''}${e.timing !== undefined ? `  ${Math.round(e.timing)}ms` : ''}`);
      const more = offset + page.length < all.length ? `\n... ${all.length - offset - page.length} more; pass offset=${offset + page.length}` : '';
      return textResult(`${lines.join('\n')}${more}`, `Pass a smaller limit or offset=${offset + page.length}.`);
    },
  },
  {
    name: 'browser_network_detail',
    description: 'Headers, request body and response body of one request from browser_network.',
    inputSchema: schema({ id: { type: 'integer', description: 'Request id from browser_network.' } }, ['id']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const d = await logs.network.detail(a.id as number);
      if (!d) return failResult(`No request with id ${a.id}`);
      const headers = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
      const parts = [`Request headers:\n${headers(d.requestHeaders)}`, `Response headers:\n${headers(d.responseHeaders)}`];
      if (d.postData) parts.push(`Request body:\n${d.postData}`);
      if (d.body !== undefined) parts.push(d.base64 ? `Response body: binary, ${d.body.length} base64 chars (not shown)` : `Response body${d.truncated ? ' (truncated by the app)' : ''}:\n${d.body}`);
      return textResult(parts.join('\n\n'), 'The response body is cut; fetch the resource with browser_eval for a slice.');
    },
  },
  {
    name: 'browser_eval',
    description: 'Evaluate a JavaScript expression in the page and return the result as text.',
    inputSchema: schema({
      expression: { type: 'string' },
      awaitPromise: { type: 'boolean', description: 'Wait for a returned promise, default true.' },
      timeoutMs: { type: 'integer', description: 'Default 10000.' },
    }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const r = await runtimeEval(session, a.expression as string, { awaitPromise: a.awaitPromise !== false, ...(num(a, 'timeoutMs') ? { timeoutMs: num(a, 'timeoutMs')! } : {}) });
      return r.ok ? textResult(r.text, 'Return less from the expression.') : failResult(r.text);
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element (selector) or a point of the viewport (x and y, CSS pixels).',
    inputSchema: schema({ selector: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const selector = str(a, 'selector');
      if (!selector && (num(a, 'x') === undefined || num(a, 'y') === undefined)) return failResult('Pass selector, or both x and y.');
      const p = selector ? await point(session, selector) : { x: num(a, 'x')!, y: num(a, 'y')! };
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
      await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
      return textResult(`Clicked ${selector ?? `${p.x},${p.y}`}`);
    },
  },
  {
    name: 'browser_type',
    description: 'Focus a field, replace its content with text, and optionally press Enter (submit).',
    inputSchema: schema({ selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, ['selector', 'text']),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const selector = a.selector as string;
      const r = await runtimeEval(
        session,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if (el.select) el.select(); return true; })()`,
        { returnByValue: true, awaitPromise: false },
      );
      if (!r.ok) return failResult(r.text);
      if (r.value !== true) return failResult(`No element matches ${selector}`);
      if (a.text === '') await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
      else await session.send('Input.insertText', { text: a.text });
      if (bool(a, 'submit')) {
        await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      }
      return textResult(`Typed into ${selector}${bool(a, 'submit') ? ' and pressed Enter' : ''}`);
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until an element (selector) exists or the page text contains text; fails after timeoutMs.',
    inputSchema: schema({ selector: { type: 'string' }, text: { type: 'string' }, timeoutMs: { type: 'integer', description: 'Default 10000, at most 60000.' } }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const selector = str(a, 'selector');
      const text = str(a, 'text');
      if (!selector && !text) return failResult('Pass selector or text.');
      const expression = selector ? `!!document.querySelector(${JSON.stringify(selector)})` : `(document.body?.innerText ?? '').includes(${JSON.stringify(text)})`;
      const timeout = Math.min(num(a, 'timeoutMs') ?? 10_000, 60_000);
      const deadline = Date.now() + timeout;
      for (;;) {
        const r = await runtimeEval(session, expression, { returnByValue: true, awaitPromise: false, timeoutMs: 5000 });
        if (!r.ok) return failResult(r.text);
        if (r.value === true) return textResult(`Found ${selector ? `element ${selector}` : `text "${text}"`}`);
        if (Date.now() >= deadline) return failResult(`Timed out after ${timeout}ms waiting for ${selector ? `element ${selector}` : `text "${text}"`}`);
        await new Promise((res) => setTimeout(res, 200));
      }
    },
  },
];
