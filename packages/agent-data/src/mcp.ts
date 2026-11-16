import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Routes } from '@kedalion/server-core';

export const MCP_PATH = '/api/agent-data/mcp';
export const SERVER_KEY = 'kedalion-data';
/** Text of one tool result is cut to this many characters. */
export const TEXT_CAP = 20_000;
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolProp {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: readonly string[];
  additionalProperties?: { type: 'string' };
  items?: { type: 'string' | 'object' | 'array'; items?: { type: 'string' } };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, ToolProp>; required?: readonly string[] };
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

/** Text cut to `TEXT_CAP`; when cut, it ends with `hint` (names the parameter that fetches the rest). */
export function capText(text: string, hint: string): string {
  if (text.length <= TEXT_CAP) return text;
  const tail = `\n... [cut: ${TEXT_CAP} of ${text.length} chars] ${hint}`;
  return text.slice(0, TEXT_CAP - tail.length) + tail;
}

export const textResult = (text: string, hint = 'Ask for less output.'): ToolResult => ({ content: [{ type: 'text', text: capText(text, hint) }] });
export const failResult = (message: string): ToolResult => ({ content: [{ type: 'text', text: capText(message, 'Ask for less output.') }], isError: true });

type Id = string | number | null;
export interface RpcReply {
  status: number;
  body?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const failure = (id: Id, code: number, message: string): RpcReply => ({ status: 200, body: { jsonrpc: '2.0', id, error: { code, message } } });
const success = (id: Id, result: unknown): RpcReply => ({ status: 200, body: { jsonrpc: '2.0', id, result } });

/** First problem of `args` against the schema (required keys, types, enums), or undefined. */
export function checkArgs(schema: McpTool['inputSchema'], args: Record<string, unknown>): string | undefined {
  for (const key of schema.required ?? []) if (args[key] === undefined) return `Missing argument: ${key}`;
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop || value === undefined) continue;
    const ok = prop.type === 'integer' ? Number.isInteger(value) : prop.type === 'array' ? Array.isArray(value) : prop.type === 'object' ? isObject(value) : typeof value === prop.type;
    if (!ok) return `Argument ${key} must be a ${prop.type}`;
    if (prop.enum && !prop.enum.includes(value as string)) return `Argument ${key} must be one of: ${prop.enum.join(', ')}`;
  }
  return undefined;
}

/** Handles one JSON-RPC message (already parsed, or the parse failure as `undefined`). */
export async function handleRpc(msg: unknown, tools: readonly McpTool[], instructions?: string): Promise<RpcReply> {
  if (msg === undefined) return failure(null, -32700, 'Parse error');
  if (!isObject(msg) || msg.jsonrpc !== '2.0') return failure(null, -32600, 'Invalid request');
  const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
  const id: Id = hasId ? (msg.id as string | number) : null;
  if (typeof msg.method !== 'string') return hasId && ('result' in msg || 'error' in msg) ? { status: 202 } : failure(id, -32600, 'Invalid request');
  if (msg.method.startsWith('notifications/') || !hasId) return { status: 202 };
  const params = msg.params;
  if (params !== undefined && !isObject(params)) return failure(id, -32602, 'Invalid params');
  switch (msg.method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      const protocolVersion = typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0]!;
      return success(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: SERVER_KEY, version: '1.0.0' }, ...(instructions ? { instructions } : {}) });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return failure(id, -32602, typeof params?.name === 'string' ? `Unknown tool: ${params.name}` : 'Missing tool name');
      const args = params?.arguments ?? {};
      if (!isObject(args)) return failure(id, -32602, 'Arguments must be an object');
      const problem = checkArgs(tool.inputSchema, args);
      if (problem) return failure(id, -32602, problem);
      let result: ToolResult;
      try {
        result = await tool.run(args);
      } catch (e) {
        result = failResult(e instanceof Error ? e.message : String(e));
      }
      return success(id, result);
    }
    default:
      return failure(id, -32601, `Method not found: ${msg.method}`);
  }
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
export function mcpRoutes(opts: { secret: () => string; tools: readonly McpTool[]; instructions?: string }): Routes {
  return {
    [`POST ${MCP_PATH}`]: async ({ req }) => {
      if (!bearerOk(req, opts.secret())) return jsonResponse(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
      let msg: unknown;
      try {
        msg = JSON.parse(await req.text());
      } catch {
        msg = undefined;
      }
      const reply = await handleRpc(msg, opts.tools, opts.instructions);
      return jsonResponse(reply.status, reply.body);
    },
    [`GET ${MCP_PATH}`]: ({ req }) => (bearerOk(req, opts.secret()) ? jsonResponse(405, { error: 'Method not allowed' }, { allow: 'POST' }) : jsonResponse(401, { error: 'Unauthorized' })),
  };
}

/** The `--mcp-config` content that points Claude at this endpoint. */
export const buildMcpConfig = (origin: string, secret: string) => ({ mcpServers: { [SERVER_KEY]: { type: 'http', url: `${origin}${MCP_PATH}`, headers: { Authorization: `Bearer ${secret}` } } } });

/** The bearer secret kept in `<dataDir>/mcp-secret`, so running sessions survive an app restart; created on first use. */
export function loadSecret(dataDir: string): string {
  const path = join(dataDir, 'mcp-secret');
  try {
    const saved = readFileSync(path, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(saved)) return saved;
  } catch {}
  const secret = randomBytes(24).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, secret, { mode: 0o600 });
    restrictToCurrentUser(path);
  } catch {}
  return secret;
}

/** Windows ignores the file mode: drop inherited permissions and grant only the current user. Best effort. */
function restrictToCurrentUser(path: string): void {
  const user = process.env.USERNAME;
  if (process.platform !== 'win32' || !user) return;
  try {
    spawnSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  } catch {}
}

/** Writes `<dataDir>/mcp.json` once the origin is known (rewritten when origin or secret change); returns its path, else undefined. */
export function createConfigFile(opts: { dataDir: string; secret: () => string; origin: () => string | undefined }): () => string | undefined {
  let writtenKey: string | undefined;
  const path = join(opts.dataDir, 'mcp.json');
  return () => {
    const origin = opts.origin();
    if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) return undefined;
    const key = `${origin}|${opts.secret()}`;
    if (writtenKey === key) return path;
    mkdirSync(opts.dataDir, { recursive: true });
    writeFileSync(path, JSON.stringify(buildMcpConfig(origin, opts.secret())), { mode: 0o600 });
    restrictToCurrentUser(path);
    writtenKey = key;
    return path;
  };
}
