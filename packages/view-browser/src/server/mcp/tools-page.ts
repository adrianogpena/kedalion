import { normalizeWebAddress } from '../../address.ts';
import { compactUrl, decodeOperations, prettyBody, STATIC_TYPES, summarizeRequest } from '../../ops.ts';
import { stepLogFor } from './steps.ts';
import { bool, num, pageSession, resolveTab, runtimeEval, str, withTimeout } from './page-util.ts';
import { PAGE_LIB } from './page-lib.ts';
import { DEFAULT_SNAPSHOT_CHARS, type PageSnapshot, renderSnapshot, SNAPSHOT_SECTIONS, type SnapshotSection } from './snapshot.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { failResult, type McpTool, textResult, type ToolContext, type ToolSchema } from './types.ts';

const TAB = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' } as const;
const schema = (properties: ToolSchema['properties'], required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});

const BODY_SLICE = 8000;
const BODY_SLICE_MAX = 15_000;
const REQUEST_BODY_SLICE = 3000;
const GREP_CONTEXT = 2;

/** One slice of a response body (or only its lines matching `grep`), with how to read the rest. */
function sliceBody(body: string, note: string, offset: number, limit: number, grep?: string): string {
  if (grep) {
    const lines = body.split('\n');
    const needle = grep.toLowerCase();
    const keep = new Set<number>();
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes(needle)) for (let k = Math.max(i - GREP_CONTEXT, 0); k <= Math.min(i + GREP_CONTEXT, lines.length - 1); k++) keep.add(k);
    });
    if (!keep.size) return `Response body${note}: no line contains "${grep}" (${lines.length} lines, ${body.length} chars).`;
    const out: string[] = [];
    let prev = -2;
    for (const i of [...keep].sort((x, y) => x - y)) {
      if (i !== prev + 1) out.push('--');
      out.push(`${i + 1}: ${lines[i]!.length > 500 ? `${lines[i]!.slice(0, 500)}...` : lines[i]}`);
      prev = i;
    }
    return `Response body${note}, lines matching "${grep}" (line numbers):\n${out.join('\n')}`;
  }
  const start = Math.min(Math.max(offset, 0), body.length);
  const size = Math.min(Math.max(limit, 1), BODY_SLICE_MAX);
  const end = Math.min(start + size, body.length);
  const tail = end < body.length ? `\n... [response body chars ${start}-${end} of ${body.length}] pass bodyOffset=${end} (bodyLimit up to ${BODY_SLICE_MAX}) for the next part, or grep=<text> for matching lines` : '';
  return `Response body${note}:\n${body.slice(start, end)}${tail}`;
}

/** Waits (up to `ms`) for the main-document request after `since` and returns its failure text, if it failed. */
async function navFailure(ctx: ToolContext, tab: string, since: number, ms = 2000): Promise<string | undefined> {
  const logs = ctx.service.logs(tab);
  if (!logs) return undefined;
  const deadline = Date.now() + ms;
  for (;;) {
    const main = logs.network.entries({ since, filter: { type: 'document' } }).at(-1);
    if (main?.failed && main.failed !== 'canceled') return main.failed;
    if (main?.done) return undefined;
    if (Date.now() >= deadline) return undefined;
    await new Promise((res) => setTimeout(res, 100));
  }
}

const lastNetworkId = (ctx: ToolContext, tab: string): number => ctx.service.logs(tab)?.network.entries({ limit: 1 }).at(-1)?.id ?? 0;

const tabLine =(t: { id: string; title: string; url: string; loading: boolean }, active: boolean) => `${active ? '*' : ' '} ${t.id}  ${t.title || '(untitled)'}  ${t.url}${t.loading ? '  (loading)' : ''}`;

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
      let url: string;
      try {
        url = normalizeWebAddress(str(a, 'url') ?? '');
      } catch (e) {
        return failResult((e as Error).message);
      }
      const wanted = str(a, 'tab');
      const target = wanted ?? ctx.service.activeTab();
      if (bool(a, 'newTab') || !target) {
        const t = await ctx.service.open(url);
        const failed = await navFailure(ctx, t.id, 0);
        if (failed) return failResult(`Navigation failed: ${failed} (tab ${t.id}, ${url})`);
        return textResult(`Opened ${t.url} in tab ${t.id}`);
      }
      const tab = await resolveTab(ctx, { tab: target });
      const since = lastNetworkId(ctx, tab);
      const navError = (await ctx.service.navigate(tab, url)) ?? (await navFailure(ctx, tab, since));
      if (navError) return failResult(`Navigation failed: ${navError}`);
      return textResult(`Navigating tab ${tab} to ${url}`);
    },
  },
  {
    name: 'browser_navigate',
    description: 'Go back, go forward, reload or stop loading.',
    inputSchema: schema({ action: { type: 'string', enum: ['back', 'forward', 'reload', 'stop'] } }, ['action']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const since = lastNetworkId(ctx, tab);
      await ctx.service.action(tab, a.action as 'back' | 'forward' | 'reload' | 'stop');
      if (a.action !== 'stop') {
        const failed = await navFailure(ctx, tab, since);
        if (failed) return failResult(`Navigation failed: ${failed}`);
      }
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
    description:
      'Text snapshot of the page: title, url, headings, form fields (ref, password values masked), Clickable elements (buttons, links, tabs, td/div clickables, menu items, each with a ref e1.. usable by browser_click/type/fill/select until the next snapshot or navigation), links (30 per page) and visible text, pruned to maxChars. scope limits it to a container (selector or its text); section limits it to headings, fields, clickable, links or text; limit and offset page Clickable and Links.',
    inputSchema: schema({
      maxChars: { type: 'integer', description: `Budget of the snapshot, default ${DEFAULT_SNAPSHOT_CHARS}.` },
      scope: { type: 'string', description: 'CSS selector or text of a container.' },
      section: { type: 'string', enum: SNAPSHOT_SECTIONS, description: 'Only this section.' },
      limit: { type: 'integer', description: 'Items of Clickable and Links, default 60 and 30.' },
      offset: { type: 'integer', description: 'Items of Clickable and Links to skip.' },
    }),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const section = str(a, 'section') as SnapshotSection | undefined;
      const sections = section ? [section] : undefined;
      const r = await runtimeEval(session, `(() => { const kd = ${PAGE_LIB}; return kd.snapshot(${JSON.stringify(str(a, 'scope') ?? null)}, ${!sections || section === 'clickable'}); })()`, { returnByValue: true, awaitPromise: false });
      if (!r.ok) return failResult(r.text);
      if ((r.value as { error?: string }).error) return failResult((r.value as { error: string }).error);
      const maxChars = Math.min(Math.max(num(a, 'maxChars') ?? DEFAULT_SNAPSHOT_CHARS, 200), 19_000);
      return textResult(renderSnapshot(r.value as PageSnapshot, { maxChars, sections, limit: num(a, 'limit'), offset: num(a, 'offset') }), 'Pass a smaller maxChars.');
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
      const lines = entries.map((e) => `#${e.id} [${e.level}]${e.frame ? ` {${e.frame}}` : ''} ${e.text}${e.source ? `  (${e.source.url}:${e.source.line})` : ''}${e.stack ? `\n${e.stack.split('\n').map((l) => `    ${l}`).join('\n')}` : ''}`);
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
      failedOnly: { type: 'boolean', description: 'Failed or canceled requests and HTTP 4xx/5xx.' },
      compact: { type: 'boolean', description: 'Hide successful static requests (images, styles, scripts, fonts, media) and show URLs as path plus short query values.' },
      limit: { type: 'integer', description: 'Default 50.' },
      offset: { type: 'integer', description: 'Skip this many matches, default 0.' },
      body: { type: 'string', description: 'Only requests whose decoded request body or recorded response body contains this text (case-insensitive).' },
      sinceMark: { type: 'string', description: 'Only requests after the named browser_network_mark.' },
      pendingOver: { type: 'integer', description: 'Only requests still pending after more than this many ms; shows their age.' },
    }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const url = str(a, 'url');
      const type = str(a, 'type');
      const markName = str(a, 'sinceMark');
      let since: number | undefined;
      if (markName) {
        since = stepLogFor(ctx.service).networkMarks.get(markName);
        if (since === undefined) return failResult(`No network mark named ${markName}. Create it with browser_network_mark.`);
      }
      const bodyText = str(a, 'body')?.toLowerCase();
      const pendingOver = num(a, 'pendingOver');
      const now = Date.now();
      const rec = (id: number) => logs.network.recorded(id);
      let all = logs.network.entries({
        ...(since !== undefined ? { since } : {}),
        filter: { ...(url ? { text: url } : {}), ...(type ? { type } : {}), ...(num(a, 'status') !== undefined ? { status: num(a, 'status')! } : {}), ...(bool(a, 'failedOnly') ? { failed: true } : {}) },
      });
      if (pendingOver !== undefined) all = all.filter((e) => !e.done && now - (e.startedAt ?? now) > pendingOver);
      if (bodyText) {
        all = all.filter((e) => {
          const r = rec(e.id);
          if (!r) return false;
          const req = r.postData ? `${r.postData}\n${prettyBody(r.postData, 'application/x-www-form-urlencoded')}` : '';
          return req.toLowerCase().includes(bodyText) || (r.body?.toLowerCase().includes(bodyText) ?? false);
        });
      }
      const compact = bool(a, 'compact');
      let hidden = 0;
      if (compact) {
        const before = all.length;
        all = all.filter((e) => e.failed || (e.status ?? 0) >= 400 || !e.type || !STATIC_TYPES.has(e.type.toLowerCase()));
        hidden = before - all.length;
      }
      if (!all.length) return textResult(hidden ? `No matching requests (${hidden} static hidden).` : 'No matching requests.');
      const offset = Math.max(num(a, 'offset') ?? 0, 0);
      const limit = Math.max(num(a, 'limit') ?? 50, 1);
      const page = all.slice(offset, offset + limit);
      const lines = page.map((e) => {
        const ops = summarizeRequest({ url: e.url, postData: rec(e.id)?.postData });
        const age = !e.done && e.startedAt !== undefined ? `  pending ${Math.round((now - e.startedAt) / 1000)}s` : '';
        return `#${e.id} ${e.method} ${e.status ?? (e.failed ? 'FAILED' : '...')} ${e.type ?? ''} ${compact ? compactUrl(e.url) : e.url}${e.failed ? `  (${e.failed})` : ''}${e.fromCache ? '  (cache)' : ''}${e.frame ? `  {${e.frame}}` : ''}${e.timing !== undefined ? `  ${Math.round(e.timing)}ms` : ''}${age}${ops ? `  | ${ops}` : ''}`;
      });
      const more = offset + page.length < all.length ? `\n... ${all.length - offset - page.length} more; pass offset=${offset + page.length}` : '';
      const note = hidden ? `\n(${hidden} static requests hidden by compact)` : '';
      return textResult(`${lines.join('\n')}${more}${note}`, `Pass a smaller limit or offset=${offset + page.length}.`);
    },
  },
  {
    name: 'browser_network_detail',
    description: 'Headers, request body and response body of one request from browser_network. Bodies of requests from before a navigation are kept (preserve logs on), capped per body.',
    inputSchema: schema(
      {
        id: { type: 'integer', description: 'Request id from browser_network.' },
        decoded: { type: 'boolean', description: 'Default true: url-decoded, indented request body and the list of RPC operations.' },
        bodyOffset: { type: 'integer', description: 'Response body: first character to show, default 0.' },
        bodyLimit: { type: 'integer', description: `Response body: characters to show, default ${BODY_SLICE}, max ${BODY_SLICE_MAX}.` },
        grep: { type: 'string', description: 'Response body: only the lines containing this text (case-insensitive), with 2 lines of context.' },
        saveBody: { type: 'boolean', description: 'Write the whole decoded response body to a file in the view data folder (bodies/<id>) and return its path.' },
      },
      ['id'],
    ),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const save = bool(a, 'saveBody');
      const d = await logs.network.detail(a.id as number, { full: save });
      if (!d) return failResult(`No request with id ${a.id}`);
      if (save) {
        if (d.body === undefined) return failResult(`Request ${a.id} has no response body to save.`);
        const dir = resolve(ctx.dataDir, 'bodies');
        const file = resolve(dir, String(Math.trunc(Number(a.id))).replace(/[^0-9]/g, '') || '0');
        if (!file.startsWith(dir + sep)) return failResult('Invalid id.');
        await mkdir(dir, { recursive: true });
        const data = d.base64 ? Buffer.from(d.body, 'base64') : d.body;
        await writeFile(file, data);
        return textResult(`Saved response body of #${a.id} (${d.mime ?? 'unknown type'}, ${typeof data === 'string' ? Buffer.byteLength(data) : data.length} bytes) to ${file}`);
      }
      const headers = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
      const parts = [`Request headers:\n${headers(d.requestHeaders)}`, `Response headers:\n${headers(d.responseHeaders)}`];
      if (d.postData) {
        if (a.decoded === false) parts.push(`Request body:\n${d.postData}`);
        else {
          const contentType = d.requestHeaders['Content-Type'] ?? d.requestHeaders['content-type'] ?? '';
          const grep = str(a, 'grep');
          const ops = decodeOperations(d.postData).map((o, i) => ({ ...o, n: i + 1 }));
          const shown = grep ? ops.filter((o) => `${o.operation} ${o.args}`.toLowerCase().includes(grep.toLowerCase())) : ops;
          if (ops.length) parts.push(`Operations (${grep ? `${shown.length} of ${ops.length} match "${grep}"` : ops.length}):\n${shown.map((o) => `${o.n}. ${o.operation}  ${o.args}`).join('\n')}`);
          parts.push(sliceBody(prettyBody(d.postData, contentType), '', 0, REQUEST_BODY_SLICE, grep).replace(/^Response body/, 'Request body (decoded)'));
        }
      }
      if (d.body !== undefined) {
        if (d.base64) parts.push(`Response body: binary ${d.mime ?? 'unknown type'}, ${d.bodyBytes ?? Math.floor((d.body.length * 3) / 4)} bytes${d.truncated ? ' (cut)' : ''}; not shown, pass saveBody=true to write it to a file`);
        else parts.push(sliceBody(d.body, d.truncated ? ' (truncated by the app)' : '', num(a, 'bodyOffset') ?? 0, num(a, 'bodyLimit') ?? BODY_SLICE, str(a, 'grep')));
      }
      if (d.blockedCookies?.length) parts.push(`Blocked cookies:\n${d.blockedCookies.join('\n')}`);
      if (d.frames) {
        const f = d.frames;
        parts.push(`Frames (${f.length}, newest last; payload cut at 4 KB):\n${f.map((x, i) => `${i + 1}. ${x.dir === 'sent' ? '>>' : '<<'} ${x.opcode} ${x.payload.length > 300 ? `${x.payload.slice(0, 300)}...` : x.payload}`).join('\n')}`);
      }
      return textResult(parts.join('\n\n'), 'Output is cut; use bodyOffset/bodyLimit or grep to read the response body in parts.');
    },
  },
  {
    name: 'browser_network_mark',
    description: 'Remember the current end of the network log under a name; browser_network sinceMark=<name> then lists only later requests.',
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      const id = logs.network.entries({ limit: 1 }).at(-1)?.id ?? 0;
      stepLogFor(ctx.service).networkMarks.set(a.name as string, id);
      return textResult(`Mark ${a.name} set after request #${id}.`);
    },
  },
  {
    name: 'browser_cookies',
    description: 'List the cookies of the tab page (scope page, default) or of the whole browser (scope all). Values are shown; clear them with browser_cookies_clear.',
    inputSchema: schema({ scope: { type: 'string', enum: ['page', 'all'] }, name: { type: 'string', description: 'Only cookies whose name contains this text.' } }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const name = str(a, 'name')?.toLowerCase();
      const list = (await ctx.service.cookies(tab, str(a, 'scope') === 'all' ? 'all' : 'page')).filter((c) => !name || c.name.toLowerCase().includes(name));
      if (!list.length) return textResult('No cookies.');
      const lines = list.map((c) => `${c.domain}${c.path}  ${c.name}=${c.value}  ${c.expires === undefined ? 'session' : `expires ${new Date(c.expires * 1000).toISOString()}`}${c.httpOnly ? ' HttpOnly' : ''}${c.secure ? ' Secure' : ''}${c.sameSite ? ` SameSite=${c.sameSite}` : ''}`);
      return textResult(lines.join('\n'), 'Pass name to narrow the list.');
    },
  },
  {
    name: 'browser_cookies_clear',
    description: 'Delete cookies: one by name (and optional domain), all of the tab page (scope page, default) or all of the browser (scope all).',
    inputSchema: schema({ scope: { type: 'string', enum: ['page', 'all'] }, name: { type: 'string', description: 'Delete only the cookies with this exact name.' }, domain: { type: 'string', description: 'With name: only this domain.' } }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const scope = str(a, 'scope') === 'all' ? 'all' : 'page';
      const name = str(a, 'name');
      if (!name) return textResult(`Cleared ${await ctx.service.clearCookies(tab, scope)} cookies.`);
      const domain = str(a, 'domain');
      const hit = (await ctx.service.cookies(tab, scope)).filter((c) => c.name === name && (!domain || c.domain === domain));
      for (const c of hit) await ctx.service.deleteCookie(tab, c);
      return textResult(`Deleted ${hit.length} cookie${hit.length === 1 ? '' : 's'} named ${name}.`);
    },
  },
  {
    name: 'browser_eval',
    description: 'Evaluate a JavaScript expression in the page and return the result as text.',
    inputSchema: schema({
      expression: { type: 'string' },
      awaitPromise: { type: 'boolean', description: 'Wait for a returned promise, default true.' },
      timeoutMs: { type: 'integer', description: 'Default 10000.' },
    }, ['expression']),
    async run(a, ctx) {
      const { session } = await pageSession(ctx, a);
      const r = await runtimeEval(session, a.expression as string, { awaitPromise: a.awaitPromise !== false, ...(num(a, 'timeoutMs') ? { timeoutMs: num(a, 'timeoutMs')! } : {}) });
      return r.ok ? textResult(r.text, 'Return less from the expression.') : failResult(r.text);
    },
  },
  {
    name: 'browser_wait_for',
    description:
      'Wait until an element (selector) exists or the page text contains text; fails after timeoutMs. gone=true waits until that text or selector is no longer visible (e.g. a "Loading..." overlay). idle=true waits until no XHR/fetch request has been pending for 500ms (alone or after the other condition).',
    inputSchema: schema({
      selector: { type: 'string' },
      text: { type: 'string' },
      gone: { type: 'boolean', description: 'Wait until the text or selector is no longer visible.' },
      idle: { type: 'boolean', description: 'Wait until no XHR/fetch is pending for 500ms.' },
      timeoutMs: { type: 'integer', description: 'Default 10000, at most 60000.' },
    }),
    async run(a, ctx) {
      const { tab, session } = await pageSession(ctx, a);
      const selector = str(a, 'selector');
      const text = str(a, 'text');
      const gone = bool(a, 'gone');
      const idle = bool(a, 'idle');
      if (!selector && !text && !idle) return failResult('Pass selector, text or idle.');
      const what = selector ? `element ${selector}` : `text "${text}"`;
      const present = selector
        ? `(() => { try { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; if (!${gone}) return true; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } })()`
        : `(document.body?.innerText ?? '').includes(${JSON.stringify(text)})`;
      const logs = ctx.service.logs(tab);
      const pending = () => (logs ? logs.network.entries().filter((e) => !e.done && !e.failed && /^(xhr|fetch)$/i.test(e.type ?? '') && Date.now() - (e.startedAt ?? Date.now()) < 30_000).length : 0);
      const timeout = Math.min(num(a, 'timeoutMs') ?? 10_000, 60_000);
      const deadline = Date.now() + timeout;
      let quietSince = 0;
      let conditionMet = !selector && !text;
      for (;;) {
        if (!conditionMet) {
          const r = await runtimeEval(session, present, { returnByValue: true, awaitPromise: false, timeoutMs: 5000 });
          if (!r.ok) return failResult(r.text);
          conditionMet = gone ? r.value !== true : r.value === true;
        }
        if (conditionMet && idle) {
          if (pending() === 0) {
            quietSince ||= Date.now();
            if (Date.now() - quietSince >= 500) return textResult(`${selector || text ? `${what} ${gone ? 'gone' : 'found'}; ` : ''}network idle`);
          } else quietSince = 0;
        } else if (conditionMet) return textResult(gone ? `Gone: ${what}` : `Found ${what}`);
        if (Date.now() >= deadline) return failResult(`Timed out after ${timeout}ms waiting for ${conditionMet ? 'network idle' : `${what}${gone ? ' to disappear' : ''}`}`);
        await new Promise((res) => setTimeout(res, 150));
      }
    },
  },
];
