import { lineCol, type JsonFailure } from './json-tools';

type Token = { kind: 'decl' | 'comment' | 'cdata' | 'doctype' | 'open' | 'close' | 'self' | 'text'; raw: string; name: string };
type Tokens = { ok: true; tokens: Token[] } | JsonFailure;

const NAME = /^[A-Za-z_:][\w:.-]*/;

const fail = (text: string, at: number, message: string): JsonFailure => ({ ok: false, message, ...lineCol(text, at) });

/** Index of the `>` that ends the tag starting at `from`, skipping quoted attribute values; -1 when it never ends. */
function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Splits `text` into tokens and checks that it is well-formed: one root element, matching tags, quoted attributes. */
function tokenize(text: string): Tokens {
  const tokens: Token[] = [];
  const stack: { name: string; at: number }[] = [];
  let roots = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const end = text.indexOf('<', i);
      const raw = text.slice(i, end < 0 ? text.length : end);
      if (!stack.length && raw.trim()) return fail(text, i + raw.length - raw.trimStart().length, 'Text outside the root element');
      tokens.push({ kind: 'text', raw, name: '' });
      i += raw.length;
      continue;
    }
    const special = (open: string, close: string, kind: Token['kind']): boolean | JsonFailure => {
      if (!text.startsWith(open, i)) return false;
      const end = text.indexOf(close, i + open.length);
      if (end < 0) return fail(text, i, `Unterminated ${kind}`);
      tokens.push({ kind, raw: text.slice(i, end + close.length), name: '' });
      i = end + close.length;
      return true;
    };
    let handled: boolean | JsonFailure = false;
    for (const [open, close, kind] of [['<!--', '-->', 'comment'], ['<![CDATA[', ']]>', 'cdata'], ['<?', '?>', 'decl']] as const) {
      handled = special(open, close, kind);
      if (handled) break;
    }
    if (typeof handled === 'object') return handled;
    if (handled) {
      if (tokens.at(-1)?.kind === 'cdata' && !stack.length) return fail(text, i, 'Text outside the root element');
      continue;
    }
    const end = tagEnd(text, i + 1);
    if (end < 0) return fail(text, i, 'Unterminated tag');
    const raw = text.slice(i, end + 1);
    if (/^<!DOCTYPE/i.test(raw)) {
      tokens.push({ kind: 'doctype', raw, name: '' });
      i = end + 1;
      continue;
    }
    if (raw.startsWith('</')) {
      const name = raw.slice(2, -1).trim();
      const top = stack.pop();
      if (!top) return fail(text, i, `Unexpected closing tag </${name}>`);
      if (top.name !== name) return fail(text, i, `Closing tag </${name}> does not match <${top.name}>`);
      tokens.push({ kind: 'close', raw, name });
      i = end + 1;
      continue;
    }
    const inner = raw.slice(1, -1);
    const name = NAME.exec(inner)?.[0];
    if (!name) return fail(text, i + 1, 'Invalid tag name');
    const attrs = inner.slice(name.length).replace(/\/\s*$/, '');
    if (attrs.replace(/\s+[A-Za-z_:][\w:.-]*\s*=\s*("[^"]*"|'[^']*')/g, '').trim()) return fail(text, i + 1 + name.length, `Invalid attributes on <${name}>`);
    const self = /\/\s*$/.test(inner);
    if (!stack.length && ++roots > 1) return fail(text, i, 'More than one root element');
    tokens.push({ kind: self ? 'self' : 'open', raw, name });
    if (!self) stack.push({ name, at: i });
    i = end + 1;
  }
  const open = stack.at(-1);
  if (open) return fail(text, text.length, `Unclosed tag <${open.name}>`);
  if (!roots) return fail(text, text.length, 'No root element');
  return { ok: true, tokens };
}

/** Well-formedness check; on failure the position is where the problem was found. */
export function validateXml(text: string): { ok: true } | JsonFailure {
  const r = tokenize(text);
  return r.ok ? { ok: true } : r;
}

/** Pretty-prints with 2 spaces; text-only elements stay on one line. */
export function formatXml(text: string): { ok: true; text: string } | JsonFailure {
  const r = tokenize(text);
  if (!r.ok) return r;
  const tokens = r.tokens.filter((t) => t.kind !== 'text' || t.raw.trim());
  const lines: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const pad = '  '.repeat(depth);
    const body = tokens[i + 1];
    const end = tokens[i + 2];
    if (t.kind === 'open' && body?.kind === 'text' && end?.kind === 'close') {
      lines.push(`${pad}${t.raw}${body.raw.trim()}${end.raw}`);
      i += 2;
    } else if (t.kind === 'close') {
      depth = Math.max(0, depth - 1);
      lines.push(`${'  '.repeat(depth)}${t.raw}`);
    } else {
      lines.push(`${pad}${t.kind === 'text' ? t.raw.trim() : t.raw}`);
      if (t.kind === 'open') depth++;
    }
  }
  return { ok: true, text: lines.join('\n') };
}

/** Drops the whitespace between tags. */
export function minifyXml(text: string): { ok: true; text: string } | JsonFailure {
  const r = tokenize(text);
  if (!r.ok) return r;
  return { ok: true, text: r.tokens.filter((t) => t.kind !== 'text' || t.raw.trim()).map((t) => (t.kind === 'text' ? t.raw.trim() : t.raw)).join('') };
}
