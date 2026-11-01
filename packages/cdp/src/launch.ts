import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { findAppBrowser } from '@kedalion/platform';
import { invalid } from '@kedalion/server-core';

export interface BrowserArgsOptions {
  profileDir: string;
  allowOrigin: string;
}

export function browserArgs(opts: BrowserArgsOptions): string[] {
  return [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-allow-origins=${opts.allowOrigin}`,
  ];
}

export function parsePortFile(text: string): { port: number; wsPath: string } | null {
  const lines = text.split(/\r?\n/);
  const port = Number(lines[0]?.trim());
  const wsPath = lines[1]?.trim() ?? '';
  if (!Number.isInteger(port) || port <= 0 || !wsPath) return null;
  return { port, wsPath };
}

export interface LaunchOptions extends BrowserArgsOptions {
  executable?: string;
  timeoutMs?: number;
}

export interface LaunchedBrowser {
  port: number;
  wsUrl: string;
  process: ReturnType<typeof Bun.spawn>;
  kill(): void;
  exited: Promise<number>;
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const executable = opts.executable ?? findAppBrowser();
  if (!executable) throw invalid('browserNotFound', 'No Edge or Chrome browser was found');
  const portFile = join(opts.profileDir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const proc = Bun.spawn([executable, ...browserArgs(opts)], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  const deadline = Date.now() + (opts.timeoutMs ?? 15000);
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const parsed = parsePortFile(readFileSync(portFile, 'utf8'));
      if (parsed) {
        const wsUrl = `ws://127.0.0.1:${parsed.port}${parsed.wsPath}`;
        // Edge's launcher process exits right after it starts the real browser, so `proc.exited` says nothing
        // about the browser. A monitor socket tells when the browser is gone and closes it with `Browser.close`.
        const monitor = new WebSocket(wsUrl);
        const exited = new Promise<number>((resolve) => {
          monitor.addEventListener('close', () => resolve(0));
          monitor.addEventListener('error', () => resolve(1));
        });
        const kill = () => {
          const close = () => monitor.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
          if (monitor.readyState === WebSocket.OPEN) close();
          else if (monitor.readyState === WebSocket.CONNECTING) monitor.addEventListener('open', close);
          proc.kill();
        };
        return { port: parsed.port, wsUrl, process: proc, kill, exited };
      }
    }
    await Bun.sleep(50);
  }
  proc.kill();
  throw invalid('browserStartTimeout', 'The browser did not report a debugging port; a stale browser process may hold the profile');
}
