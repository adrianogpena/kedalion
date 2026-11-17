// OS-specific code lives here, so apps and the other packages stay portable.
import { basename } from 'node:path';
import { resolveBrowser } from './browser.ts';
export * from './browser.ts';
export * from './editors.ts';
export * from './errors.ts';
export * from './exe.ts';
export * from './files.ts';
export * from './home.ts';
export * from './notifications.ts';
export * from './json-file.ts';
export * from './rename-retry.ts';
export * from './run.ts';
export * from './secrets.ts';
export * from './theme.ts';
export * from './trash.ts';
export * from './win/autostart.ts';
export * from './win/hidden.ts';
export * from './win/icon-png.ts';
export * from './win/placement.ts';
export * from './win/powershell.ts';
export * from './win/protocol.ts';
export * from './win/toast.ts';
export * from './win/tray.ts';

/**
 * Reports a fatal error: on stderr, and on Windows also in a message box, because the exe is
 * built without a console. Blocks until the box is closed.
 */
export function showError(title: string, text: string): void {
  console.error(`${title}: ${text}`);
  if (process.platform !== 'win32') return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', {
      MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    const wide = (s: string) => Buffer.from(`${s}\0`, 'utf16le');
    const MB_ICONERROR = 0x10;
    user32.symbols.MessageBoxW(null, wide(text), wide(title), MB_ICONERROR);
    user32.close();
  } catch {
    // stderr above is the fallback
  }
}

/**
 * Shows a native window (an HWND) on Windows; elsewhere a no-op. A process started hidden
 * (`bun run` passes SW_HIDE in its STARTUPINFO) gets that value instead of its first ShowWindow
 * call, so the window a library showed once stays hidden; this second call is honoured.
 */
export function showWindow(hwnd: import('bun:ffi').Pointer | null): void {
  if (process.platform !== 'win32' || !hwnd) return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', {
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    });
    const SW_SHOW = 5;
    user32.symbols.ShowWindow(hwnd, SW_SHOW);
    user32.close();
  } catch {
    // the window stays as the library left it
  }
}

/** Whether the HWND still names a window (true on other platforms, where it cannot be told). */
export function windowExists(hwnd: number): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', { IsWindow: { args: [FFIType.ptr], returns: FFIType.i32 } });
    const alive = user32.symbols.IsWindow(hwnd as unknown as import('bun:ffi').Pointer) !== 0;
    user32.close();
    return alive;
  } catch {
    return true;
  }
}

/** Brings a native window (an HWND) to the front on Windows, restoring it if minimized; elsewhere a no-op. */
export function focusWindow(hwnd: number | import('bun:ffi').Pointer | null): void {
  if (process.platform !== 'win32' || !hwnd) return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', {
      IsIconic: { args: [FFIType.ptr], returns: FFIType.i32 },
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
      SetForegroundWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
      AttachThreadInput: { args: [FFIType.u32, FFIType.u32, FFIType.i32], returns: FFIType.i32 },
    });
    const kernel32 = dlopen('kernel32.dll', { GetCurrentThreadId: { args: [], returns: FFIType.u32 } });
    const h = hwnd as import('bun:ffi').Pointer;
    const SW_RESTORE = 9;
    if (user32.symbols.IsIconic(h)) user32.symbols.ShowWindow(h, SW_RESTORE);
    // Attaching to the foreground window's thread lets SetForegroundWindow raise instead of only flashing the taskbar.
    const fg = user32.symbols.GetForegroundWindow();
    const fgThread = fg ? user32.symbols.GetWindowThreadProcessId(fg, null) : 0;
    const me = kernel32.symbols.GetCurrentThreadId();
    const attach = fgThread !== 0 && fgThread !== me;
    if (attach) user32.symbols.AttachThreadInput(me, fgThread, 1);
    user32.symbols.SetForegroundWindow(h);
    if (attach) user32.symbols.AttachThreadInput(me, fgThread, 0);
    user32.close();
    kernel32.close();
  } catch {
    // the window stays where it is
  }
}

/**
 * Sets a native window's title-bar and taskbar icon (Windows) to the icon embedded in the running
 * exe. The webview library picks its own icon; this makes the exe's `--windows-icon` the one shown.
 * A no-op elsewhere and when running from source (the exe would be bun's).
 */
export function setWindowIconFromExe(hwnd: import('bun:ffi').Pointer | null): void {
  if (process.platform !== 'win32' || !hwnd || /^bun(\.exe)?$/i.test(basename(process.execPath))) return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const shell32 = dlopen('shell32.dll', {
      ExtractIconExW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    });
    const user32 = dlopen('user32.dll', {
      SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.u64 },
    });
    const large = new BigUint64Array(1);
    const small = new BigUint64Array(1);
    const path = Buffer.from(`${process.execPath}\0`, 'utf16le');
    shell32.symbols.ExtractIconExW(path, 0, large, small, 1);
    const WM_SETICON = 0x80;
    if (small[0]) user32.symbols.SendMessageW(hwnd, WM_SETICON, 0n, small[0]); // ICON_SMALL
    if (large[0]) user32.symbols.SendMessageW(hwnd, WM_SETICON, 1n, large[0]); // ICON_BIG
    shell32.close();
    user32.close();
  } catch {
    // the window keeps the library's icon
  }
}

let chosenBrowser: string | undefined;

/** Browser `openExternal` uses (a name from `NAMED_BROWSERS` or an executable path); blank or undefined = the system default. */
export function setBrowser(spec: string | undefined): void {
  chosenBrowser = spec;
}

/** Opens a URL in the chosen browser (`setBrowser`), else the default one; best-effort, failures are ignored. */
export function openExternal(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const browser = resolveBrowser(chosenBrowser);
  const cmd = browser
    ? [browser, url]
    : process.platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url];
  try {
    Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true }).unref();
  } catch {
    // no browser launcher available
  }
}
