/** Splits a one-file unified diff into its header and hunks; line endings are kept (split on `\n` only). */
export function splitDiff(diff: string): { header: string[]; hunks: string[][] } {
  const lines = diff.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const header: string[] = [];
  const hunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('@@ ')) hunks.push([line]);
    else if (hunks.length) hunks[hunks.length - 1]!.push(line);
    else header.push(line);
  }
  return { header, hunks };
}

/** A path as git writes it in a patch header: C-quoted when it has a quote, backslash, control or non-ASCII char. */
export function quotePatchPath(prefix: string, path: string): string {
  const full = prefix + path;
  if (!/["\\\x00-\x1f\x7f-￿]/.test(full)) return full;
  let out = '"';
  for (const byte of new TextEncoder().encode(full)) {
    const c = String.fromCharCode(byte);
    if (c === '"' || c === '\\') out += '\\' + c;
    else if (c === '\t') out += '\\t';
    else if (c === '\n') out += '\\n';
    else if (byte < 0x20 || byte >= 0x7f) out += '\\' + byte.toString(8).padStart(3, '0');
    else out += c;
  }
  return out + '"';
}

/**
 * Rewrites the `diff --git`, `---` and `+++` headers of a one-file patch to `path`, so a change taken under
 * an old name applies to the renamed file. `/dev/null` sides stay. Rename and copy headers are dropped, as the
 * patch then edits `path` in place. Returns undefined when there is no `diff --git` line.
 */
export function retargetPatch(patch: string, path: string): string | undefined {
  const lines = patch.split('\n');
  const start = lines.findIndex((l) => l.startsWith('diff --git '));
  if (start < 0) return undefined;
  const a = quotePatchPath('a/', path);
  const b = quotePatchPath('b/', path);
  const out: string[] = [];
  let inHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const cr = l.endsWith('\r') ? '\r' : '';
    if (l.startsWith('diff --git ')) {
      inHeader = true;
      out.push(`diff --git ${a} ${b}${cr}`);
    } else if (inHeader && l.startsWith('@@ ')) {
      inHeader = false;
      out.push(l);
    } else if (inHeader && /^(rename|copy) (from|to) |^similarity index /.test(l)) continue;
    else if (inHeader && l.startsWith('--- ')) out.push(l.startsWith('--- /dev/null') ? l : `--- ${a}${cr}`);
    else if (inHeader && l.startsWith('+++ ')) out.push(l.startsWith('+++ /dev/null') ? l : `+++ ${b}${cr}`);
    else out.push(l);
  }
  return out.join('\n');
}

/**
 * A patch holding the file header and one hunk (`"\ No newline at end of file"` lines stay with it), for
 * `git apply --cached [--reverse]`. Returns undefined for a missing hunk or a diff without a text header (binary).
 */
export function hunkToPatch(diff: string, hunkIndex: number): string | undefined {
  const { header, hunks } = splitDiff(diff);
  const hunk = hunks[hunkIndex];
  if (!hunk || !header.some((l) => l.startsWith('--- ') || l.startsWith('+++ ')) || header.some((l) => l.startsWith('Binary files') || l === 'GIT binary patch')) return undefined;
  return [...header, ...hunk].join('\n') + '\n';
}
