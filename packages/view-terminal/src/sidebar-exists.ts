import { statSync } from 'node:fs';

export const EXISTS_MAX_PATHS = 200;

export type StatFn = (path: string) => { isDirectory(): boolean };

/** The Windows path of a drive path (`X:\a`, `X:/a`, `/mnt/x/a`, `/x/a`), or null for anything else (`~`, other POSIX). */
export function windowsPathOf(input: string): string | null {
  const p = input.trim();
  const m = /^([a-zA-Z]):(?:[\\/](.*))?$/.exec(p) ?? /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(p) ?? /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (!m) return null;
  const rest = (m[2] ?? '').split(/[\\/]+/).filter(Boolean).join('\\');
  return `${m[1]!.toUpperCase()}:\\${rest}`;
}

/** The subset of `paths` that is a drive path whose folder does not exist. */
export function missingPaths(paths: string[], stat: StatFn = statSync): string[] {
  return paths.filter((p) => {
    const w = windowsPathOf(p);
    if (!w) return false;
    try {
      return !stat(w).isDirectory();
    } catch {
      return true;
    }
  });
}

/** The checked list of paths from a request body, or null. */
export function validExistsBody(raw: unknown): string[] | null {
  const paths = (raw as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(paths) || paths.length > EXISTS_MAX_PATHS) return null;
  return paths.every((p) => typeof p === 'string' && p.length <= 2000) ? (paths as string[]) : null;
}
