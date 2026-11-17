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
