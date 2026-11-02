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

/**
 * A browser left over from a previous app run still holds the profile: a new launch hands off to it and never
 * writes a port file. Its port file is still there, so close it through CDP before launching.
 */
async function closeStaleBrowser(portFile: string): Promise<void> {
  if (!existsSync(portFile)) return;
  const parsed = parsePortFile(readFileSync(portFile, 'utf8'));
  if (!parsed) return;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${parsed.port}${parsed.wsPath}`);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      ws.close();
      done();
    }, 3000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    ws.addEventListener('close', done);
    ws.addEventListener('error', done);
  });
  await Bun.sleep(500);
}

/**
 * A failed launch deletes the port file, so an orphaned browser can outlive it with no way to close it through CDP.
 * Stop every browser process that still uses the profile directory.
 */
async function killProfileProcesses(profileDir: string): Promise<void> {
  const dir = profileDir.replace(/'/g, "''");
  const cmd =
    process.platform === 'win32'
      ? [
          'powershell',
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=${dir}') -or $_.CommandLine -like '*--user-data-dir="${dir}"*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ]
      : ['pkill', '-f', `--user-data-dir=${profileDir}`];
  try {
    await Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true }).exited;
  } catch {
    // Nothing to stop, or no tool to stop it with; the launch timeout reports a held profile.
  }
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const executable = opts.executable ?? findAppBrowser();
  if (!executable) throw invalid('browserNotFound', 'No Edge or Chrome browser was found');
  const portFile = join(opts.profileDir, 'DevToolsActivePort');
  await closeStaleBrowser(portFile);
  await killProfileProcesses(opts.profileDir);
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
