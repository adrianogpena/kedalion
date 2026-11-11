import { timingSafeEqual } from 'node:crypto';
import type { Routes } from '@kedalion/server-core';
import { addStep, describeRequest, stepLogFor, summarizeArgs, summarizeResult } from './steps.ts';
import { capText, type McpTool, type ToolArgs, type ToolContext, type ToolResult, type ToolSchema } from './types.ts';

export const MCP_PATH = '/api/browser/mcp';
export const SERVER_NAME = 'kedalion-browser';
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

type Id = string | number | null;

export interface RpcReply {
  status: number;
  body?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const failure = (id: Id, code: number, message: string): RpcReply => ({ status: 200, body: { jsonrpc: '2.0', id, error: { code, message } } });
const success = (id: Id, result: unknown): RpcReply => ({ status: 200, body: { jsonrpc: '2.0', id, result } });

/** First problem of `args` against the schema (required keys, types, enums), or undefined. */
export function checkArgs(schema: ToolSchema, args: ToolArgs): string | undefined {
  for (const key of schema.required ?? []) if (args[key] === undefined) return `Missing argument: ${key}`;
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop || value === undefined) continue;
    const ok = prop.type === 'integer' ? Number.isInteger(value) : typeof value === prop.type;
    if (!ok) return `Argument ${key} must be a ${prop.type}`;
    if (prop.enum && !prop.enum.includes(value as string)) return `Argument ${key} must be one of: ${prop.enum.join(', ')}`;
  }
  return undefined;
}

/** Starts the step record of one tool call; the returned function completes it. Never throws. */
function beginStep(tool: string, args: ToolArgs, ctx: ToolContext): (result: ToolResult) => void {
  if (tool.startsWith('browser_steps')) return () => {};
  const started = Date.now();
  let logs: ReturnType<ToolContext['service']['logs']>;
  let netBefore = 0;
  let conBefore = 0;
  try {
    const tab = typeof args.tab === 'string' ? args.tab : ctx.service.activeTab();
    logs = tab ? ctx.service.logs(tab) : undefined;
    netBefore = logs?.network.entries({ limit: 1 }).at(-1)?.id ?? 0;
    conBefore = logs?.console.entries({ limit: 1 }).at(-1)?.id ?? 0;
  } catch {
    logs = undefined;
  }
  return (result) => {
    try {
      const requests: string[] = [];
      let consoleErrors = 0;
      if (logs) {
        for (const e of logs.network.entries({ since: netBefore })) requests.push(describeRequest(e, logs.network.recorded(e.id)?.postData));
        consoleErrors = logs.console.entries({ since: conBefore, filter: { level: 'error' } }).length;
      }
      const text = result.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join(' ');
      addStep(stepLogFor(ctx.service), {
        tool,
        args: summarizeArgs(args, tool),
        ok: !result.isError,
        ms: Date.now() - started,
        at: new Date(started).toISOString(),
        result: summarizeResult(text),
        requests,
        consoleErrors,
      });
    } catch {
      // the step log must never break a tool call
    }
  };
}

function capContent(result: ToolResult): ToolResult {
  return { ...result, content: result.content.map((c) => (c.type === 'text' ? { ...c, text: capText(c.text, 'Ask for less output.') } : c)) };
}

/** Handles one JSON-RPC message (already parsed, or the parse failure as `undefined`). */
export async function handleRpc(msg: unknown, tools: readonly McpTool[], ctx: () => ToolContext, instructions?: string): Promise<RpcReply> {
  if (msg === undefined) return failure(null, PARSE_ERROR, 'Parse error');
  if (!isObject(msg) || msg.jsonrpc !== '2.0') return failure(null, INVALID_REQUEST, 'Invalid request');
  const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
  const id: Id = hasId ? (msg.id as string | number) : null;
  if (typeof msg.method !== 'string') {
    if (!hasId && msg.id !== undefined) return failure(null, INVALID_REQUEST, 'Invalid request');
    if (hasId && ('result' in msg || 'error' in msg)) return { status: 202 };
    return failure(id, INVALID_REQUEST, 'Invalid request');
  }
  const method = msg.method;
  if (method.startsWith('notifications/') || !hasId) return { status: 202 };
  const params = msg.params;
  if (params !== undefined && !isObject(params)) return failure(id, INVALID_PARAMS, 'Invalid params');

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      const protocolVersion = typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0]!;
      return success(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: '1.0.0' }, ...(instructions ? { instructions } : {}) });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      if (typeof name !== 'string') return failure(id, INVALID_PARAMS, 'Missing tool name');
      const tool = tools.find((t) => t.name === name);
      if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      const args = params?.arguments ?? {};
      if (!isObject(args)) return failure(id, INVALID_PARAMS, 'Arguments must be an object');
      const problem = checkArgs(tool.inputSchema, args);
      if (problem) return failure(id, INVALID_PARAMS, problem);
      const context = ctx();
      const record = beginStep(tool.name, args, context);
      let result: ToolResult;
      try {
        result = capContent(await tool.run(args, context));
      } catch (e) {
        result = { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
      record(result);
      return success(id, result);
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

export interface McpRouteOptions {
  secret: string;
  tools: readonly McpTool[];
  context: () => ToolContext;
  /** Shown to the client in the `initialize` reply. */
  instructions?: string;
  /** False while the setting `browser.agentTools` is off. */
  enabled?: () => boolean | Promise<boolean>;
}

const jsonResponse = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } });

function bearerOk(req: Request, secret: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The endpoint as `unauthenticated` routes: Streamable HTTP with plain JSON replies, its own Bearer check. */
export function mcpRoutes(opts: McpRouteOptions): Routes {
  return {
    [`POST ${MCP_PATH}`]: async ({ req }) => {
      if (!bearerOk(req, opts.secret)) return jsonResponse(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
      if (opts.enabled && !(await opts.enabled())) return jsonResponse(403, { error: 'The browser agent tools are off.' });
      let msg: unknown;
      try {
        msg = JSON.parse(await req.text());
      } catch {
        msg = undefined;
      }
      const reply = await handleRpc(msg, opts.tools, opts.context, opts.instructions);
      return jsonResponse(reply.status, reply.body);
    },
    [`GET ${MCP_PATH}`]: ({ req }) => (bearerOk(req, opts.secret) ? jsonResponse(405, { error: 'Method not allowed' }, { allow: 'POST' }) : jsonResponse(401, { error: 'Unauthorized' })),
  };
}
