import type { DbCredentials, DbPlanRow, DbSessions } from '@kedalion/db';
import { cellText, jsonRows, tsv, writeReason } from './format.ts';
import { failResult, type McpTool, textResult, type ToolResult } from './mcp.ts';

export interface SqlConnection {
  id: string;
  name: string;
  url: string;
  user: string;
}

export interface SqlDeps {
  connections(): Promise<SqlConnection[]>;
  /** Server-side lookup (password included); null when `id` is unknown. Never shown to the agent. */
  credentials(id: string): Promise<DbCredentials | null>;
  /** The sessions the Workbench uses: one session per connection, with its uncommitted changes. */
  sessions: DbSessions;
}

const MAX_ROWS = 1000;
const DEFAULT_ROWS = 50;
const DEFAULT_CELL = 200;
const DEFAULT_TIMEOUT_MS = 60_000;

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), min), max) : fallback);

const CONNECTION = { type: 'string', description: 'Connection name or id from sql_connections. Required: use the one the user named or the session context names; if there is none, ask the user, never choose.' } as const;

/** The SQL tools: run, commit/rollback, schema, table details and plans against the saved Oracle connections. */
export function sqlTools(deps: SqlDeps): McpTool[] {
  async function pick(ref: unknown): Promise<{ id: string; name: string; creds: DbCredentials }> {
    const all = await deps.connections();
    if (all.length === 0) throw new Error('No saved database connections. The user adds one in the Workbench or Explorer.');
    const wanted = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
    const found = wanted ? (all.find((c) => c.id === ref) ?? all.find((c) => c.name.toLowerCase() === wanted)) : undefined;
    if (!found) throw new Error(wanted ? `Unknown connection "${ref}". Saved: ${all.map((c) => c.name).join(', ')}` : `No connection given. Ask the user which connection to use; do not choose one. Saved: ${all.map((c) => c.name).join(', ')}`);
    const creds = await deps.credentials(found.id);
    if (!creds) throw new Error(`Connection "${found.name}" no longer exists.`);
    return { id: found.id, name: found.name, creds };
  }

  const pendingNote = (pending: boolean) => (pending ? '\nUNCOMMITTED changes are open on this connection: call sql_commit or sql_rollback.' : '');

  async function run(args: Record<string, unknown>): Promise<ToolResult> {
    const sql = String(args.sql).trim().replace(/;\s*$/, '');
    if (!sql) return failResult('Empty statement.');
    const reason = writeReason(sql);
    if (reason && args.allowWrite !== true) return failResult(`Refused: ${reason}. Only SELECT and WITH run by default; pass allowWrite=true to run this statement. Nothing is committed until sql_commit (or commit=true).`);
    const { id, name, creds } = await pick(args.connection);
    const maxRows = num(args.maxRows, DEFAULT_ROWS, 1, MAX_ROWS);
    const maxCell = num(args.maxCell, DEFAULT_CELL, 20, 5000);
    const timeoutMs = num(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 600_000);
    const started = performance.now();
    const timer = setTimeout(() => void deps.sessions.cancel(id).catch(() => {}), timeoutMs);
    try {
      const result = await deps.sessions.run(id, creds, sql, { maxRows });
      if (result.kind === 'done') {
        if (args.commit === true) await deps.sessions.commit(id);
        const status = deps.sessions.status(id);
        const ms = Math.round(performance.now() - started);
        const affected = result.rowsAffected === undefined ? 'done' : `${result.rowsAffected} rows affected`;
        return textResult(`[${name}] ${affected}, ${ms} ms${args.commit === true ? ', committed' : ''}.${pendingNote(status.pending)}`);
      }
      const rows: unknown[][] = [];
      let more = false;
      await deps.sessions.rows(
        result.run,
        async (item) => {
          if (Array.isArray(item)) rows.push(item);
          else more = true;
        },
        new AbortController().signal,
      );
      const ms = Math.round(performance.now() - started);
      const columns = result.columns.map((c) => c.name);
      const head = `[${name}] ${rows.length} row${rows.length === 1 ? '' : 's'}, ${ms} ms${more ? `, more rows exist (maxRows=${maxRows}; narrow the query or raise maxRows up to ${MAX_ROWS})` : ''}`;
      const body = args.format === 'json' ? jsonRows(columns, rows, maxCell) : tsv(columns, rows, maxCell);
      return textResult(`${head}\n${body}${pendingNote(deps.sessions.status(id).pending)}`, 'Lower maxRows or maxCell, or select fewer columns.');
    } finally {
      clearTimeout(timer);
    }
  }

  const finish = (op: 'commit' | 'rollback') => async (args: Record<string, unknown>): Promise<ToolResult> => {
    const { id, name } = await pick(args.connection);
    const status = await deps.sessions[op](id);
    return textResult(status.connected ? `[${name}] ${op === 'commit' ? 'committed' : 'rolled back'}.` : `[${name}] no open session; nothing to ${op}.`);
  };

  const planText = (rows: DbPlanRow[]) =>
    rows
      .map((r) => {
        const extra = [r.cost !== null ? `cost=${r.cost}` : '', r.cardinality !== null ? `rows=${r.cardinality}` : '', r.accessPredicates ? `access: ${r.accessPredicates}` : '', r.filterPredicates ? `filter: ${r.filterPredicates}` : ''].filter(Boolean);
        return `${'  '.repeat(r.depth)}${r.operation}${r.options ? ` ${r.options}` : ''}${r.objectName ? ` ${r.objectOwner ? `${r.objectOwner}.` : ''}${r.objectName}` : ''}${extra.length ? `  (${extra.join('; ')})` : ''}`;
      })
      .join('\n');

  return [
    {
      name: 'sql_connections',
      description: 'List the saved Oracle connections (name, url, user). Passwords are never shown. Pass a name as `connection` to the other sql_* tools.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const all = await deps.connections();
        if (all.length === 0) return textResult('No saved connections. The user adds one in the Workbench or Explorer.');
        return textResult(['name\turl\tuser', ...all.map((c) => `${c.name}\t${c.url}\t${c.user}`)].join('\n'));
      },
    },
    {
      name: 'sql_run',
      description: `Run one SQL statement on a saved Oracle connection and return the rows as a tab-separated table (header line first), with row count and time. Read-only by default: only SELECT and WITH run; DML, DDL and PL/SQL need allowWrite=true and stay uncommitted until sql_commit (or commit=true). One statement per call, no trailing semicolon. Rows are capped by maxRows (default ${DEFAULT_ROWS}, max ${MAX_ROWS}) and cells by maxCell; the connection keeps its session between calls, shared with the Workbench.`,
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The statement.' },
          connection: CONNECTION,
          maxRows: { type: 'integer', description: `Most rows returned (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).` },
          maxCell: { type: 'integer', description: `Most characters per cell (default ${DEFAULT_CELL}).` },
          format: { type: 'string', enum: ['tsv', 'json'], description: 'tsv (default, cheapest) or json (array of objects).' },
          allowWrite: { type: 'boolean', description: 'Allow a statement that is not SELECT/WITH. Default false.' },
          commit: { type: 'boolean', description: 'Commit right after a successful write (default false).' },
          timeoutMs: { type: 'integer', description: `Cancel after this long (default ${DEFAULT_TIMEOUT_MS}).` },
        },
        required: ['sql'],
      },
      run,
    },
    {
      name: 'sql_commit',
      description: 'Commit the uncommitted changes of a connection.',
      inputSchema: { type: 'object', properties: { connection: CONNECTION } },
      run: finish('commit'),
    },
    {
      name: 'sql_rollback',
      description: 'Roll back the uncommitted changes of a connection. Use it to undo a test write.',
      inputSchema: { type: 'object', properties: { connection: CONNECTION } },
      run: finish('rollback'),
    },
    {
      name: 'sql_schema',
      description: 'Tables and views with their columns, one line each: NAME [view] (COL TYPE, ...; ! after the type = NOT NULL). Filter by name to keep it short; the owner defaults to the connection user.',
      inputSchema: {
        type: 'object',
        properties: {
          connection: CONNECTION,
          owner: { type: 'string', description: 'Schema owner (default: the connection user).' },
          filter: { type: 'string', description: 'Table name contains this text (case-insensitive); * is a wildcard.' },
          columns: { type: 'boolean', description: 'Show columns (default true); false lists only the table names.' },
          limit: { type: 'integer', description: 'Most tables listed (default 40).' },
        },
      },
      async run(args) {
        const { id, name, creds } = await pick(args.connection);
        const owner = typeof args.owner === 'string' && args.owner ? args.owner.toUpperCase() : undefined;
        const schema = await deps.sessions.schema(id, creds, owner);
        const filter = typeof args.filter === 'string' ? args.filter.trim() : '';
        const test = filter ? new RegExp(filter.includes('*') ? `^${filter.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$` : filter.replace(/[.+?^${}()|[\]\\*]/g, '\\$&'), 'i') : undefined;
        const hits = schema.tables.filter((t) => !test || test.test(t.name));
        const limit = num(args.limit, 40, 1, 500);
        const showColumns = args.columns !== false;
        const lines = hits.slice(0, limit).map((t) => `${t.name}${t.kind === 'view' ? ' [view]' : ''}${showColumns ? ` (${t.columns.map((c) => `${c.name} ${c.type}${c.nullable ? '' : '!'}`).join(', ')})` : ''}`);
        const note = [
          `[${name}] owner ${schema.owner}: ${hits.length} of ${schema.tables.length} tables`,
          hits.length > limit ? `showing ${limit}, narrow with filter or raise limit` : '',
          schema.truncated ? 'column list was cut by the server limit' : '',
          !owner ? `other owners: ${schema.owners.filter((o) => o !== schema.owner).slice(0, 15).join(', ')}${schema.owners.length > 16 ? ', ...' : ''}` : '',
        ].filter(Boolean);
        return textResult(`${note.join('; ')}\n${lines.join('\n')}`, 'Use filter, columns=false or a lower limit.');
      },
    },
    {
      name: 'sql_table',
      description: 'Indexes, constraints (primary, unique, foreign keys, checks) and the DDL of one table.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Table name.' }, connection: CONNECTION, owner: { type: 'string', description: 'Schema owner (default: the connection user).' }, ddl: { type: 'boolean', description: 'Include the DDL (default true; it can be long).' } },
        required: ['name'],
      },
      async run(args) {
        const { id, name, creds } = await pick(args.connection);
        const d = await deps.sessions.table(id, creds, typeof args.owner === 'string' ? args.owner.toUpperCase() : '', String(args.name));
        const out = [`[${name}] ${d.owner}.${d.name}`];
        out.push(`indexes: ${d.indexes.length ? d.indexes.map((i) => `${i.name}${i.unique ? ' unique' : ''}(${i.columns.join(', ')})`).join('; ') : 'none'}`);
        out.push(
          `constraints: ${d.constraints.length ? '' : 'none'}`,
          ...d.constraints.map((c) => `  ${c.type} ${c.name} (${c.columns.join(', ')})${c.condition ? ` ${c.condition}` : ''}${c.references ? ` -> ${c.references.owner}.${c.references.table}(${c.references.columns.join(', ')})` : ''}`),
        );
        if (args.ddl !== false) out.push(d.ddl ? `ddl:\n${d.ddl.trim()}` : 'ddl: not readable by this user');
        return textResult(out.join('\n'), 'Pass ddl=false.');
      },
    },
    {
      name: 'sql_explain',
      description: 'The execution plan of a SELECT or DML statement as an indented tree with cost, rows and predicates. The statement is not run and nothing is committed.',
      inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'The statement to explain.' }, connection: CONNECTION }, required: ['sql'] },
      async run(args) {
        const { id, name, creds } = await pick(args.connection);
        const rows = await deps.sessions.explain(id, creds, String(args.sql).trim().replace(/;\s*$/, ''));
        return textResult(`[${name}] plan\n${planText(rows) || cellText(null, 10)}`);
      },
    },
  ];
}
