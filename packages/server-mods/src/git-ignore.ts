export type IgnoreKind = 'file' | 'folder' | 'extension';

/** Escapes glob characters and a trailing space so a path matches only itself. */
const escapeGlob = (s: string) => s.replace(/[\\*?[\]]/g, (c) => '\\' + c).replace(/ $/, '\\ ');

/** A repo-relative path is usable in a pattern: no newline, not absolute, no `..` or `.` segment. */
function cleanPath(path: string): string | undefined {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!p || /[\r\n]/.test(p) || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return undefined;
  if (p.split('/').some((s) => s === '..' || s === '.' || s === '')) return undefined;
  return p;
}

/**
 * The `.gitignore` pattern for "ignore this file / folder / extension": files and folders are anchored with
 * a leading `/` (which also keeps a leading `!` or `#` literal); an extension matches everywhere.
 * Undefined for a path that cannot be a pattern (absolute, `..`, newline) or a name without an extension.
 */
export function ignorePattern(path: string, kind: IgnoreKind): string | undefined {
  const p = cleanPath(path);
  if (!p) return undefined;
  if (kind === 'file') return '/' + escapeGlob(p);
  if (kind === 'folder') return '/' + escapeGlob(p) + '/';
  const name = p.split('/').pop()!;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return '*.' + escapeGlob(name.slice(dot + 1));
}

const eolOf = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n');

/** Appends lines that are not there yet, keeping the file's line ending and closing its last line first. */
function appendLines(content: string, lines: readonly string[], present: (line: string, existing: Set<string>) => boolean): { content: string; added: string[] } {
  const eol = eolOf(content);
  const existing = new Set(content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const added: string[] = [];
  for (const l of lines) {
    if (present(l, existing)) continue;
    existing.add(l);
    added.push(l);
  }
  if (!added.length) return { content, added };
  const head = content && !content.endsWith('\n') ? content + eol : content;
  return { content: head + added.map((l) => l + eol).join(''), added };
}

/** `.gitignore` content with the missing patterns appended. */
export function appendIgnorePatterns(content: string, patterns: readonly string[]): { content: string; added: string[] } {
  return appendLines(content, patterns, (p, existing) => existing.has(p));
}

/** Quotes a gitattributes pattern C-style when it has whitespace, a quote or a backslash. */
function attrPattern(path: string): string {
  const p = '/' + path;
  if (!/[\s"\\]/.test(p)) return p;
  return '"' + p.replace(/[\\"]/g, (c) => '\\' + c).replace(/\t/g, '\\t') + '"';
}

/**
 * `.gitattributes` content with `<pattern> <attrs...>` for `path` appended, unless that exact rule is there.
 * Undefined for an unusable path or an attribute holding whitespace.
 */
export function appendAttributesRule(content: string, path: string, attrs: readonly string[]): { content: string; added: string[] } | undefined {
  const p = cleanPath(path);
  if (!p || !attrs.length || attrs.some((a) => !a || /\s/.test(a))) return undefined;
  const rule = `${attrPattern(p)} ${attrs.join(' ')}`;
  return appendLines(content, [rule], (l, existing) => existing.has(l));
}
