import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  return regenerateMcpSecret(dataDir);
}

/** Creates a new secret, replacing `<dataDir>/mcp-secret`; the old bearer stops working once the caller uses the new one. */
export function regenerateMcpSecret(dataDir: string): string {
  const path = join(dataDir, 'mcp-secret');
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

export interface McpConfigFile {
  /** The config, or undefined while the app origin is not known. */
  config(): McpConfig | undefined;
  /** Writes `<dataDir>/mcp.json` once the origin is known; returns its path, else undefined. */
  write(): string | undefined;
}

export function createMcpConfigFile(opts: { dataDir: string; secret: string | (() => string); origin: () => string | undefined }): McpConfigFile {
  const path = join(opts.dataDir, 'mcp.json');
  const secretNow = () => (typeof opts.secret === 'function' ? opts.secret() : opts.secret);
  let written: string | undefined;
  let writtenKey: string | undefined;
  const config = () => {
    const origin = opts.origin();
    return origin && /^https?:\/\/[^/]+$/.test(origin) ? buildMcpConfig(origin, secretNow()) : undefined;
  };
  return {
    config,
    write() {
      const key = `${opts.origin()}|${secretNow()}`;
      if (written && writtenKey === key) return written;
      const c = config();
      if (!c) return undefined;
      mkdirSync(opts.dataDir, { recursive: true });
      writeFileSync(path, JSON.stringify(c), { mode: 0o600 });
      restrictToCurrentUser(path);
      written = path;
      writtenKey = key;
      return path;
    },
  };
}
