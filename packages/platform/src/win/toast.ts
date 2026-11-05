import { killTree } from '../run.ts';
import { asciiJson, forEachLine, spawnPowerShell } from './powershell.ts';

export interface Toast {
  title: string;
  body: string;
  /** URI Windows opens when the toast is clicked (http(s) opens the default browser). */
  launch: string;
  /** Absolute path of a PNG shown as the toast's logo. */
  icon?: string;
}

export interface Toaster {
  show(toast: Toast): void;
  /** Ends the host process; resolves with its exit code (null if none was running). */
  close(): Promise<number | null>;
}

const noopToaster: Toaster = { show() {}, close: async () => null };

// Own AppUserModelID, registered per user in HKCU (no Start-menu shortcut needed): its DisplayName
// is the app name in the toast header instead of "Windows PowerShell".
const APP_ID = 'Kedalion.Notifications';
const APP_NAME = 'Kedalion';

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** `file:///C:/dir/a%20b.png` for an absolute path. */
export function fileUri(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  return `file:///${encodeURI(slashed.replace(/^\/+/, '')).replace(/[#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

// activationType="protocol": Windows opens `launch` itself, so no COM activator is registered.
export function toastXml(toast: Toast): string {
  const body = toast.body === '' ? '' : `<text>${xmlEscape(toast.body)}</text>`;
  const image = toast.icon ? `<image placement="appLogoOverride" src="${xmlEscape(fileUri(toast.icon))}"/>` : '';
  return (
    `<toast activationType="protocol" launch="${xmlEscape(toast.launch)}">` +
    `<visual><binding template="ToastGeneric">${image}<text>${xmlEscape(toast.title)}</text>${body}` +
    '</binding></visual></toast>'
  );
}

/** One stdin line for the host. */
export function toastLine(toast: Toast): string {
  return `${asciiJson({ xml: toastXml(toast) })}\n`;
}

// Reads one JSON line per toast until stdin closes. A bad line is reported on stderr and skipped.
// $ProgressPreference: module-loading progress would otherwise reach stderr as CLIXML.
const HOST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\${APP_ID}'
if (-not (Test-Path $key)) { $null = New-Item -Path $key -Force }
Set-ItemProperty -Path $key -Name DisplayName -Value '${APP_NAME}'
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try {
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml(($line | ConvertFrom-Json).xml)
    $notifier.Show([Windows.UI.Notifications.ToastNotification]::new($doc))
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
}
`;

export interface ToastProcess {
  pid: number;
  write(line: string): void;
  end(): void;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type ToastSpawn = () => ToastProcess;

// stdin carries the toast lines.
const spawnHost: ToastSpawn = () => {
  const proc = spawnPowerShell(HOST_SCRIPT, { stdin: 'pipe', stdout: 'ignore' });
  return {
    pid: proc.pid,
    write(line) {
      proc.stdin.write(line);
      proc.stdin.flush();
    },
    end: () => proc.stdin.end(),
    stderr: proc.stderr,
    exited: proc.exited,
  };
};

export interface ToasterOptions {
  spawn?: ToastSpawn;
  onError?: (msg: string) => void;
}

interface Running {
  proc: ToastProcess;
  done: Promise<number>;
}

/**
 * Windows toast notifications through a long-lived PowerShell host, started on the first toast
 * and again after it dies. Off Windows (without `spawn`) it returns a toaster that does nothing.
 */
export function createToaster(opts: ToasterOptions = {}): Toaster {
  if (!opts.spawn && process.platform !== 'win32') return noopToaster;
  const spawn = opts.spawn ?? spawnHost;
  const onError = opts.onError ?? ((msg) => console.warn(`toast: ${msg}`));
  let current: Running | null = null;

  const start = (): Running => {
    const proc = spawn();
    const errors = forEachLine(proc.stderr, onError).catch(() => {});
    const entry: Running = { proc, done: Promise.resolve(0) };
    entry.done = Promise.all([proc.exited, errors]).then(([code]) => {
      if (current === entry) current = null;
      if (code !== 0) onError(`toast host exited with code ${code}`);
      return code;
    });
    current = entry;
    return entry;
  };

  return {
    show(toast) {
      const line = toastLine(toast);
      try {
        (current ?? start()).proc.write(line);
      } catch {
        // The host died between toasts and its exit isn't observed yet: start a fresh one.
        current = null;
        try {
          start().proc.write(line);
        } catch (err) {
          current = null;
          onError(`toast host unavailable: ${(err as Error).message}`);
        }
      }
    },
    async close() {
      const entry = current;
      if (!entry) return null;
      current = null;
      entry.proc.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(resolve, 5000, null);
      });
      const code = await Promise.race([entry.done, timeout]);
      clearTimeout(timer);
      if (code === null) killTree(entry.proc.pid);
      return code;
    },
  };
}

// `bun packages/platform/src/win/toast.ts --selftest`: shows one real toast; exit code 0 means
// Windows accepted it.
if (import.meta.main && process.argv.includes('--selftest')) {
  let failed = false;
  const toaster = createToaster({
    onError: (msg) => {
      failed = true;
      console.error(msg);
    },
  });
  toaster.show({ title: 'Kedalion self-test', body: 'Toasts work <&> "ção"', launch: 'https://example.com/' });
  const code = await toaster.close();
  process.exit(failed || code !== 0 ? 1 : 0);
}
