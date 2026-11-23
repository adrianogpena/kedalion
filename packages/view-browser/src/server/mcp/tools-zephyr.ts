import { resolveTab, str } from './page-util.ts';
import { failResult, type McpTool, textResult, type ToolContext } from './types.ts';

const API = /^https:\/\/[^/]*tm4j\.smartbear\.com\/backend\/rest\/tests\/2\.0\//;
const KEY = /\/testPlayer\/([A-Z][A-Z0-9]*-R\d+)/;

interface Session {
  base: string;
  headers: Record<string, string>;
}

const header = (h: Record<string, string>, name: string): string | undefined => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];

/** Credentials of the newest Zephyr Scale request any tab made (the page's own session); never shown. */
async function zephyrSession(ctx: ToolContext): Promise<Session> {
  for (const t of ctx.service.tabs().list().reverse()) {
    const logs = ctx.service.logs(t.id);
    const hit = logs?.network.entries({ filter: { text: 'tm4j.smartbear.com/backend/rest/tests/2.0/' } }).filter((e) => e.method !== 'OPTIONS' && API.test(e.url)).at(-1);
    if (!logs || !hit) continue;
    const d = await logs.network.detail(hit.id, {});
    const auth = d && header(d.requestHeaders, 'authorization');
    if (!d || !auth) continue;
    const headers: Record<string, string> = { authorization: auth, accept: 'application/json' };
    for (const name of ['jira-project-id', 'origin', 'referer']) {
      const v = header(d.requestHeaders, name);
      if (v) headers[name] = v;
    }
    return { base: hit.url.slice(0, hit.url.indexOf('/rest/tests/2.0/') + '/rest/tests/2.0'.length), headers };
  }
  throw new Error('No Zephyr session found. Open a Zephyr page (a test player, or the Zephyr panel of a ticket) in the browser first; the token lasts about 45 minutes, so reload it if it expired.');
}

async function get<T>(s: Session, path: string): Promise<T> {
  const r = await fetch(`${s.base}${path}`, { headers: s.headers });
  if (!r.ok) throw new Error(`Zephyr answered ${r.status} for ${path.split('?')[0]}${r.status === 401 ? ' (the token expired: reload the Zephyr page in the browser)' : ''}`);
  return (await r.json()) as T;
}

const plain = (html: string | undefined): string =>
  (html ?? '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

interface Item {
  id: number;
  index: number;
  $lastTestResult?: { executionDate?: string; testResultStatusId?: number; testCase?: { key: string; name: string; objective?: string; precondition?: string } };
}
interface Step {
  index: number;
  description?: string;
  expectedResult?: string;
  testData?: string;
  comment?: string;
  testResultStatusId?: number;
}
interface Result {
  key?: string;
  comment?: string;
  executionDate?: string;
  testResultStatusId?: number;
  testScriptResults?: Step[];
}

const STEP_FIELDS = 'id,key,testResultStatusId,executionDate,comment,testScriptResults(id,testResultStatusId,executionDate,comment,index,description,expectedResult,testData)';

export const zephyrTools: McpTool[] = [
  {
    name: 'zephyr_cycle',
    description:
      'Read a Zephyr Scale test cycle (Jira test player) without loading every test case. Needs a Zephyr page open in the browser (reuses its session; the token is never shown). Without item: the cycle and one line per test case (number, key, name, status, date). With item (number in the list, test case key such as VWDE-T8163, or run item id): that case with objective, precondition and its steps (description, expected result, test data, comment, status). cycle defaults to the key in the active tab URL (.../testPlayer/VWDE-R3344).',
    inputSchema: {
      type: 'object',
      properties: {
        cycle: { type: 'string', description: 'Test cycle key, e.g. VWDE-R3344; default the one in the active tab URL.' },
        item: { type: 'string', description: 'Number in the list, test case key or run item id: show that case with its steps.' },
        tab: { type: 'string', description: 'Tab id from browser_tabs whose URL names the cycle; default the active tab.' },
        status: { type: 'string', description: 'List only test cases with this status (e.g. Fail, Blocked, "Not Executed"), case-insensitive; comma separated. The list is compact (common name prefix removed, no item ids).' },
      },
    },
    async run(a, ctx) {
      try {
        const tab = await resolveTab(ctx, a);
        const key = str(a, 'cycle') ?? ctx.service.tabs().list().find((t) => t.id === tab)?.url.match(KEY)?.[1];
        if (!key) return failResult('Pass cycle (e.g. VWDE-R3344), or make the tab show a Zephyr test player.');
        const s = await zephyrSession(ctx);
        const run = await get<{ id: number; key: string; name: string; projectId: number }>(s, `/testrun/${encodeURIComponent(key)}?fields=id,key,name,projectId`);
        const [items, statuses] = await Promise.all([
          get<{ testRunItems: Item[]; total: number }>(s, `/testrun/${run.id}/testrunitems?fields=id,index,issueCount,$lastTestResult`),
          get<{ id: number; name: string }[]>(s, `/project/${run.projectId}/testresultstatus`),
        ]);
        const status = (id?: number) => statuses.find((x) => x.id === id)?.name ?? 'Not Executed';
        const rows = items.testRunItems.map((it, i) => ({ n: i + 1, it, tc: it.$lastTestResult?.testCase }));
        const want = str(a, 'item');
        if (!want) {
          const wanted = (str(a, 'status') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
          const shown = wanted.length ? rows.filter(({ it }) => wanted.includes(status(it.$lastTestResult?.testResultStatusId).toLowerCase())) : rows;
          const names = shown.map(({ tc }) => tc?.name ?? '');
          let prefix = names.length > 1 ? names.reduce((p, x) => { let i = 0; while (i < p.length && p[i] === x[i]) i++; return p.slice(0, i); }) : '';
          prefix = prefix.length > 12 ? prefix.slice(0, Math.max(prefix.lastIndexOf(' - ') + 3, prefix.lastIndexOf(': ') + 2, prefix.lastIndexOf(' ') + 1)) : '';
          const lines = shown.map(({ n, it, tc }) => `${n}. ${tc?.key ?? '?'} ${(tc?.name ?? '').slice(prefix.length)} - ${status(it.$lastTestResult?.testResultStatusId)}${it.$lastTestResult?.executionDate ? ` (${it.$lastTestResult.executionDate.slice(0, 10)})` : ''}`);
          const counts = new Map<string, number>();
          for (const { it } of rows) counts.set(status(it.$lastTestResult?.testResultStatusId), (counts.get(status(it.$lastTestResult?.testResultStatusId)) ?? 0) + 1);
          const summary = [...counts].map(([k, v]) => `${v} ${k}`).join(', ');
          return textResult(`${run.key} ${run.name}\n${items.total} test cases (${summary})${wanted.length ? `; ${shown.length} with status ${wanted.join('/')}` : ''}${prefix ? `\nCommon name prefix: "${prefix.trim()}"` : ''}\n${lines.join('\n')}`);
        }
        const row = rows.find(({ n, it, tc }) => String(n) === want || tc?.key === want || String(it.id) === want);
        if (!row) return failResult(`No test case "${want}" in ${run.key}. Use a number 1-${rows.length}, a test case key or a run item id.`);
        const results = await get<Result[]>(s, `/testrun/${run.id}/testresults?fields=${encodeURIComponent(STEP_FIELDS)}&itemId=${row.it.id}`);
        const r = results.at(-1);
        const steps = (r?.testScriptResults ?? []).sort((x, y) => x.index - y.index);
        const out = [`${run.key} #${row.n} ${row.tc?.key ?? ''} ${row.tc?.name ?? ''}`, `Status: ${status(r?.testResultStatusId ?? row.it.$lastTestResult?.testResultStatusId)}${r?.executionDate ? `, executed ${r.executionDate}` : ''}`];
        if (row.tc?.objective) out.push(`Objective: ${plain(row.tc.objective)}`);
        if (row.tc?.precondition) out.push(`Precondition: ${plain(row.tc.precondition)}`);
        if (r?.comment) out.push(`Comment: ${plain(r.comment)}`);
        for (const st of steps) {
          out.push(`Step ${st.index + 1} [${status(st.testResultStatusId)}]: ${plain(st.description)}`);
          if (st.testData) out.push(`  Data: ${plain(st.testData)}`);
          if (st.expectedResult) out.push(`  Expected: ${plain(st.expectedResult)}`);
          if (st.comment) out.push(`  Comment: ${plain(st.comment)}`);
        }
        if (!steps.length) out.push('(no step results)');
        return textResult(out.join('\n'), 'Ask for one test case at a time.');
      } catch (e) {
        return failResult(e instanceof Error ? e.message : String(e));
      }
    },
  },
];

