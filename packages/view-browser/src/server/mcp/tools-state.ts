import { type InterceptRule } from '@kedalion/cdp';
import { DEVICE_PRESETS, presetEmulation } from '../../devices.ts';
import { bool, num, resolveTab, str } from './page-util.ts';
import { failResult, type McpTool, textResult, type ToolSchema } from './types.ts';

const TAB = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' } as const;
const schema = (properties: ToolSchema['properties'], required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});

const ruleLine = (r: InterceptRule) => `${r.id}  ${r.enabled ? 'on ' : 'off'}  ${r.action}  ${r.pattern}${r.action === 'mock' ? `  -> ${r.status ?? 200} ${r.contentType ?? 'application/json'} ${(r.body ?? '').slice(0, 80)}` : ''}`;
const quote = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}... (${s.length} chars)` : s);

export const stateTools: McpTool[] = [
  {
    name: 'browser_cookie_set',
    description: 'Create or overwrite a cookie. Without domain it applies to the host of the tab page. expires is Unix seconds; leave it out for a session cookie.',
    inputSchema: schema(
      {
        name: { type: 'string' },
        value: { type: 'string' },
        domain: { type: 'string' },
        path: { type: 'string', description: 'Default /.' },
        expires: { type: 'number', description: 'Unix seconds.' },
        httpOnly: { type: 'boolean' },
        secure: { type: 'boolean' },
        sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
      },
      ['name', 'value'],
    ),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const domain = str(a, 'domain');
      const path = str(a, 'path');
      const expires = num(a, 'expires');
      const sameSite = str(a, 'sameSite') as 'Strict' | 'Lax' | 'None' | undefined;
      await ctx.service.setCookie(tab, {
        name: a.name as string,
        value: a.value as string,
        ...(domain ? { domain } : {}),
        ...(path ? { path } : {}),
        ...(expires !== undefined ? { expires } : {}),
        httpOnly: bool(a, 'httpOnly'),
        secure: bool(a, 'secure'),
        ...(sameSite ? { sameSite } : {}),
      });
      return textResult(`Cookie ${a.name} set.`);
    },
  },
  {
    name: 'browser_storage',
    description: 'List localStorage, sessionStorage and the IndexedDB database names of the tab page origin (values are cut at 200 characters).',
    inputSchema: schema({ kind: { type: 'string', enum: ['local', 'session', 'indexeddb'], description: 'Default: all three.' } }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const kind = str(a, 'kind');
      const s = await ctx.service.storage(tab);
      const out = [`Origin: ${s.origin}`];
      if (!kind || kind === 'local') out.push(`localStorage (${s.local.length}):`, ...s.local.map((i) => `  ${i.key} = ${quote(i.value)}`));
      if (!kind || kind === 'session') out.push(`sessionStorage (${s.session.length}):`, ...s.session.map((i) => `  ${i.key} = ${quote(i.value)}`));
      if (!kind || kind === 'indexeddb') out.push(`IndexedDB (${s.indexedDb.length}):`, ...s.indexedDb.map((n) => `  ${n}`));
      return textResult(out.join('\n'), 'Pass kind to list one storage.');
    },
  },
  {
    name: 'browser_storage_set',
    description: 'Set one localStorage or sessionStorage item.',
    inputSchema: schema({ kind: { type: 'string', enum: ['local', 'session'] }, key: { type: 'string' }, value: { type: 'string' } }, ['kind', 'key', 'value']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      await ctx.service.setStorageItem(tab, a.kind as 'local' | 'session', a.key as string, a.value as string);
      return textResult(`${a.kind}Storage ${a.key} set.`);
    },
  },
  {
    name: 'browser_storage_clear',
    description:
      'Clear web storage of the tab page origin: kind local, session or indexeddb (all of it, or one item/database with key), or kind site for all site data: cookies, storage, IndexedDB, caches and service workers (includeCache also clears the HTTP cache). Reload the page afterwards.',
    inputSchema: schema(
      {
        kind: { type: 'string', enum: ['local', 'session', 'indexeddb', 'site'] },
        key: { type: 'string', description: 'Only this item (or IndexedDB database name).' },
        includeCache: { type: 'boolean', description: 'With kind site: also clear the HTTP cache.' },
      },
      ['kind'],
    ),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const kind = a.kind as 'local' | 'session' | 'indexeddb' | 'site';
      const key = str(a, 'key');
      if (kind === 'site') {
        await ctx.service.clearSiteData(tab, bool(a, 'includeCache'));
        return textResult('Site data cleared.');
      }
      if (key) await ctx.service.removeStorageItem(tab, kind, key);
      else await ctx.service.clearStorage(tab, kind);
      return textResult(key ? `Removed ${key} from ${kind}.` : `Cleared ${kind}.`);
    },
  },
  {
    name: 'browser_intercept',
    description:
      'Request rules for every tab: block a URL pattern, or answer it with a fixed (mock) response. Actions: list, add, remove (id), clear. A pattern with * matches any text, without * the URL only has to contain it.',
    inputSchema: schema(
      {
        action: { type: 'string', enum: ['list', 'add', 'remove', 'clear'] },
        pattern: { type: 'string', description: 'For add.' },
        mode: { type: 'string', enum: ['block', 'mock'], description: 'For add; default block.' },
        status: { type: 'integer', description: 'Mock status, default 200.' },
        contentType: { type: 'string', description: 'Mock content type, default application/json.' },
        body: { type: 'string', description: 'Mock response body.' },
        id: { type: 'string', description: 'Rule id, for remove.' },
      },
      ['action'],
    ),
    async run(a, ctx) {
      await ctx.ready();
      const rules = ctx.service.rules();
      switch (a.action) {
        case 'list':
          return textResult(rules.length ? rules.map(ruleLine).join('\n') : 'No rules.');
        case 'clear':
          ctx.service.setRules([]);
          return textResult('Rules cleared.');
        case 'remove': {
          const id = str(a, 'id');
          if (!id || !rules.some((r) => r.id === id)) return failResult('Pass the id of an existing rule (see list).');
          ctx.service.setRules(rules.filter((r) => r.id !== id));
          return textResult(`Rule ${id} removed.`);
        }
        default: {
          const pattern = str(a, 'pattern');
          if (!pattern) return failResult('Pass pattern.');
          const mode = str(a, 'mode') === 'mock' ? 'mock' : 'block';
          const id = `r${Date.now().toString(36)}${rules.length}`;
          const rule: InterceptRule =
            mode === 'block'
              ? { id, enabled: true, pattern, action: 'block' }
              : { id, enabled: true, pattern, action: 'mock', status: num(a, 'status') ?? 200, contentType: str(a, 'contentType') ?? 'application/json', body: typeof a.body === 'string' ? a.body : '' };
          ctx.service.setRules([...rules, rule]);
          return textResult(`Rule added: ${ruleLine(rule)}`);
        }
      }
    },
  },
  {
    name: 'browser_emulate',
    description: `Make the tab act like a device: a preset (${DEVICE_PRESETS.map((p) => p.id).join(', ')}) or a custom width and height, plus user agent, locale (e.g. pt-BR) and timezone (e.g. America/Sao_Paulo). reset clears everything. Reload the page afterwards.`,
    inputSchema: schema({
      preset: { type: 'string', enum: DEVICE_PRESETS.map((p) => p.id) },
      width: { type: 'integer' },
      height: { type: 'integer' },
      dpr: { type: 'number' },
      mobile: { type: 'boolean' },
      userAgent: { type: 'string' },
      locale: { type: 'string' },
      timezone: { type: 'string' },
      reset: { type: 'boolean' },
    }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      if (bool(a, 'reset')) {
        await ctx.service.setEmulation(tab, {});
        return textResult('Emulation cleared.');
      }
      const preset = DEVICE_PRESETS.find((p) => p.id === str(a, 'preset'));
      const width = num(a, 'width');
      const height = num(a, 'height');
      const userAgent = str(a, 'userAgent');
      const locale = str(a, 'locale');
      const timezone = str(a, 'timezone');
      const e = {
        ...(preset ? presetEmulation(preset) : {}),
        ...(width && height ? { width, height, dpr: num(a, 'dpr') ?? 1, mobile: bool(a, 'mobile') } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(locale ? { locale } : {}),
        ...(timezone ? { timezone } : {}),
      };
      await ctx.service.setEmulation(tab, e);
      return textResult(`Emulation: ${JSON.stringify(e)}`);
    },
  },
  {
    name: 'browser_export_har',
    description: 'Save the network log of the tab as a HAR file in the Downloads folder; returns the path. The HAR contains cookies and Authorization headers in plain text (not redacted).',
    inputSchema: schema({}),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const r = await ctx.service.exportHar(tab);
      return textResult(`Saved ${r.count} requests to ${r.path}`);
    },
  },
  {
    name: 'browser_preserve_logs',
    description: 'Keep (on) or drop (off) the console and network logs of the tab when the page navigates. Off is the default.',
    inputSchema: schema({ on: { type: 'boolean' } }, ['on']),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const logs = ctx.service.logs(tab);
      if (!logs) return failResult(`Unknown tab: ${tab}`);
      logs.console.preserve = a.on === true;
      logs.network.preserve = a.on === true;
      return textResult(`Logs are ${a.on === true ? 'kept' : 'cleared'} on navigation.`);
    },
  },
];
