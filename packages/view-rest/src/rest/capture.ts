import type { HttpResponseInfo, RestChainCapture } from '@kedalion/server-core/protocol';

/** Segments of `$.a[2]["b c"]`, or null when the path does not parse. */
export function parsePath(path: string): Array<string | number> | null {
  if (!path.startsWith('$')) return null;
  const out: Array<string | number> = [];
  let i = 1;
  while (i < path.length) {
    const c = path[i];
    if (c === '.') {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(path.slice(i + 1));
      if (!m) return null;
      out.push(m[0]);
      i += 1 + m[0].length;
    } else if (c === '[') {
      const num = /^\[(\d+)\]/.exec(path.slice(i));
      if (num) {
        out.push(Number(num[1]));
        i += num[0].length;
        continue;
      }
      const str = /^\[("(?:[^"\\]|\\.)*")\]/.exec(path.slice(i));
      if (!str) return null;
      try {
        out.push(JSON.parse(str[1]!) as string);
      } catch {
        return null;
      }
      i += str[0].length;
    } else return null;
  }
  return out;
}

function show(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The value `capture` names in `response` (JSON body path or header name), or undefined when absent. */
export function evalCapture(response: HttpResponseInfo, capture: RestChainCapture): string | undefined {
  if (capture.from === 'header') {
    const name = capture.path.trim().toLowerCase();
    return response.headers.find(([k]) => k.toLowerCase() === name)?.[1];
  }
  const segments = parsePath(capture.path.trim());
  if (!segments || response.text === undefined) return undefined;
  let node: unknown;
  try {
    node = JSON.parse(response.text);
  } catch {
    return undefined;
  }
  for (const s of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    if (typeof s === 'number' ? !Array.isArray(node) : Array.isArray(node)) return undefined;
    node = (node as Record<string | number, unknown>)[s];
  }
  return show(node);
}
