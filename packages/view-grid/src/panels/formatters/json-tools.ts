export type JsonFailure = { ok: false; message: string; line: number; col: number };
export type JsonResult = { ok: true; value: unknown } | JsonFailure;

/** 1-based line and column of the character offset `pos` in `text`. */
export function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, col: (lines[lines.length - 1] ?? '').length + 1 };
}

const WS = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/** Offset of the first character that is not valid JSON (text.length when it ends too early), or -1 when valid. Engines differ in their messages, so the position is found here. */
export function errorOffset(text: string): number {
  let i = 0;
  const skip = () => {
    while (i < text.length && WS.has(text[i] as string)) i++;
  };
  const string = (): boolean => {
    i++;
    while (i < text.length) {
      const c = text[i] as string;
      if (c === '"') return i++, true;
      if (c < ' ') return false;
      if (c === '\\') {
        const n = text[i + 1];
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return false;
          i += 6;
          continue;
        }
        if (n === undefined || !'"\\/bfnrt'.includes(n)) return false;
        i += 2;
        continue;
      }
      i++;
    }
    return false;
  };
  const value = (): boolean => {
    skip();
    const c = text[i];
    if (c === '{') {
      i++;
      skip();
      if (text[i] === '}') return i++, true;
      for (;;) {
        skip();
        if (text[i] !== '"' || !string()) return false;
        skip();
        if (text[i] !== ':') return false;
        i++;
        if (!value()) return false;
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return i++, true;
        return false;
      }
    }
    if (c === '[') {
      i++;
      skip();
      if (text[i] === ']') return i++, true;
      for (;;) {
        if (!value()) return false;
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') return i++, true;
        return false;
      }
    }
    if (c === '"') return string();
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) return (i += word.length), true;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) return false;
    i += m[0].length;
    return true;
  };
  if (!value()) return i;
  skip();
  return i < text.length ? i : -1;
}

/** Parses `text`; on failure the position is the first invalid character. */
export function validate(text: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const message = String((err as Error).message ?? err);
    const at = errorOffset(text);
    return { ok: false, message, ...lineCol(text, at < 0 ? text.length : at) };
  }
}

/** Pretty-prints with 2 spaces, or returns the parse error. */
export function format(text: string): { ok: true; text: string } | JsonFailure {
  const r = validate(text);
  return r.ok ? { ok: true, text: JSON.stringify(r.value, null, 2) } : r;
}

/** Removes all whitespace, or returns the parse error. */
export function minify(text: string): { ok: true; text: string } | JsonFailure {
  const r = validate(text);
  return r.ok ? { ok: true, text: JSON.stringify(r.value) } : r;
}
