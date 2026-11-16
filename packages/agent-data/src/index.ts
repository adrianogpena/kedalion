import { type DbStores, parseOracleUrl } from '@kedalion/db';
import { defineServerView } from '@kedalion/server-core';
import { type AppStores, httpExecutor, httpSender } from '@kedalion/server-mods';
import { createConfigFile, loadSecret, mcpRoutes, type McpTool } from './mcp.ts';
import { restTools } from './rest.ts';
import { sqlTools } from './sql.ts';

export { handleRpc, MCP_PATH, SERVER_KEY } from './mcp.ts';
export type { McpTool, ToolResult } from './mcp.ts';
export { restTools, type RestDeps } from './rest.ts';
export { sqlTools, type SqlDeps } from './sql.ts';

/** Sent to every MCP client in the `initialize` reply. */
export const INSTRUCTIONS = `Kedalion's data tools: run SQL on the user's saved Oracle connections and send HTTP requests from the Kedalion server, for debugging and tests. Output is compact text, capped; narrow it instead of asking for everything.

SQL (sql_*)
- sql_connections lists the saved connections; pass a name as \`connection\`. Never pick a connection yourself, not even when only one is saved: use the one the user or the session context named, otherwise ask the user first. Passwords are never shown.
- sql_schema (filter by table name) -> sql_table (indexes, constraints, DDL) -> sql_run. sql_explain shows a plan without running the statement.
- sql_run is read-only: SELECT and WITH only. A write needs allowWrite=true and stays uncommitted until sql_commit; sql_rollback undoes it. Do not leave changes open and do not write to a database the user did not name. One statement per call, no trailing semicolon. Rows come as a tab-separated table; use maxRows, maxCell and fewer columns to keep it short.
- The session is shared with the Workbench, so uncommitted changes are visible there and idle sessions are rolled back.

REST (rest_*)
- rest_environments lists environments; rest_send takes method, url, headers, body, query, form, environment and vars. {{name}} is replaced from the environment (secrets are used, never shown); when a request uses {{variables}} never pick the environment yourself: use the one the user or the session context named, otherwise ask the user first; {{$uuid}} {{$timestamp}} {{$isoTimestamp}} {{$randomInt}} are built in.
- Make rest_send a test with expectStatus, expectBody and expectJson: the result ends with ASSERT PASS or ASSERT FAIL (failure is an error).
- Long bodies are cut: use select (JSON path), grep, offset/limit, or rest_body with the printed id.

Rules: clean up what you changed (roll back test writes); never print secrets you happen to see.`;

/**
 * Server half of the agent data tools: an MCP endpoint (SQL and REST) for Claude Code sessions, with its own bearer secret.
 * Needs the db stores (`dbConnections`, `sessions`) and the app stores (`environments`, ...) in `ctx.stores`.
 * `mcpConfigFile()` gives the path for `--mcp-config` (undefined until the app origin is known).
 */
export function agentDataServerView(opts: { dataDir: string; origin: () => string | undefined }) {
  const secret = loadSecret(opts.dataDir);
  const configFile = createConfigFile({ dataDir: opts.dataDir, secret: () => secret, origin: opts.origin });
  const view = defineServerView({
    id: 'agent-data',
    routes: () => ({}),
    unauthenticated: (ctx) => {
      const stores = ctx.stores as unknown as DbStores & AppStores;
      const executor = httpExecutor();
      const tools: McpTool[] = [
        ...sqlTools({
          connections: async () => (await stores.dbConnections.list()).map((c) => ({ id: c.id, name: c.name, url: c.url, user: c.user })),
          credentials: async (id) => {
            const record = await stores.dbConnections.get(id).catch(() => null);
            if (!record) return null;
            return { connectString: parseOracleUrl(record.url).connectString, user: record.user, password: (await stores.dbConnections.secret(id, 'password')) ?? '' };
          },
          sessions: stores.sessions,
        }),
        ...restTools({
          send: httpSender(executor, { environmentVars: stores.environmentVars, secretVars: stores.secretVars }),
          body: (id) => executor.body(id),
          environments: async () => (await stores.environments.list()).map((e) => ({ id: e.id, name: e.name, vars: e.vars })),
        }),
      ];
      return mcpRoutes({ secret: () => secret, tools, instructions: INSTRUCTIONS });
    },
  });
  return Object.assign(view, { mcpConfigFile: () => configFile() });
}
