import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_PATH } from './rpc.ts';

export const MCP_SERVER_KEY = 'kedalion-browser';

export interface McpConfig {
  mcpServers: Record<string, { type: 'http'; url: string; headers: { Authorization: string } }>;
}

/** The `--mcp-config` content that points Claude at this app's endpoint. */
export function buildMcpConfig(origin: string, secret: string): McpConfig {
  return { mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: `${origin}${MCP_PATH}`, headers: { Authorization: `Bearer ${secret}` } } } };
}

/** The MCP bearer secret kept in `<dataDir>/mcp-secret`, so running sessions survive an app restart; created on first use. */
export function loadMcpSecret(dataDir: string): string {
  const path = join(dataDir, 'mcp-secret');
  try {
    const saved = readFileSync(path, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(saved)) return saved;
  } catch {}
  const secret = randomBytes(24).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, secret, { mode: 0o600 });
  } catch {}
  return secret;
}

export interface McpConfigFile {
  /** The config, or undefined while the app origin is not known. */
  config(): McpConfig | undefined;
  /** Writes `<dataDir>/mcp.json` once the origin is known; returns its path, else undefined. */
  write(): string | undefined;
}

export function createMcpConfigFile(opts: { dataDir: string; secret: string; origin: () => string | undefined }): McpConfigFile {
  const path = join(opts.dataDir, 'mcp.json');
  let written: string | undefined;
  const config = () => {
    const origin = opts.origin();
    return origin && /^https?:\/\/[^/]+$/.test(origin) ? buildMcpConfig(origin, opts.secret) : undefined;
  };
  return {
    config,
    write() {
      if (written) return written;
      const c = config();
      if (!c) return undefined;
      mkdirSync(opts.dataDir, { recursive: true });
      writeFileSync(path, JSON.stringify(c), { mode: 0o600 });
      written = path;
      return path;
    },
  };
}
