const POSIX_SHELLS = new Set(["git-bash", "bash", "zsh", "fish", "sh"]);

type Drive = { drive: string; rest: string };

function parseDrive(input: string): Drive | null {
  const p = input.trim();
  let m = /^([a-zA-Z]):(?:[\\/](.*))?$/.exec(p);
  if (!m) m = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (!m) m = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (!m) return null;
  const rest = (m[2] ?? "").split(/[\\/]+/).filter(Boolean).join("/");
  return { drive: m[1]!.toLowerCase(), rest };
}

export function toShellPath(path: string, shell: string | undefined): string {
  const d = parseDrive(path);
  if (!d) return path;
  if (shell === "wsl") return d.rest ? `/mnt/${d.drive}/${d.rest}` : `/mnt/${d.drive}`;
  if (shell && POSIX_SHELLS.has(shell)) return d.rest ? `/${d.drive}/${d.rest}` : `/${d.drive}`;
  return `${d.drive.toUpperCase()}:\\${d.rest.replace(/\//g, "\\")}`;
}

export function cdCommand(path: string, shell: string | undefined): string {
  const p = toShellPath(path, shell);
  if (shell === "cmd") return `cd /d "${p}"`;
  if (shell === "wsl" || (shell && POSIX_SHELLS.has(shell))) {
    if (p === "~") return "cd ~";
    if (p.startsWith("~/")) return `cd ~/'${p.slice(2).replace(/'/g, "'\\''")}'`;
    return `cd '${p.replace(/'/g, "'\\''")}'`;
  }
  return `cd '${p.replace(/'/g, "''")}'`;
}

export function expandPlaceholders(text: string, ctx: { cwd?: string; clipboard?: string }): string {
  return text.replace(/\{(cwd|clipboard)\}/g, (all, key: "cwd" | "clipboard") => ctx[key] ?? all);
}

export const hasClipboardPlaceholder = (text: string): boolean => text.includes("{clipboard}");
