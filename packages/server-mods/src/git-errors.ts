const ANSI = /\u001b\[[0-9;]*m/g;

/** Ordered rules; the first match wins, so the specific ones come first. */
const RULES: Array<[RegExp, string]> = [
  [/dubious ownership/i, 'Git refuses this folder: its owner differs. Add it to safe.directory.'],
  [/not a git repository/i, 'This folder is not in a Git repository.'],
  [/rebase.*in progress|you are currently rebasing|interactive rebase/i, 'A rebase is in progress. Finish or abort it first.'],
  [/you have unmerged paths|unresolved conflict|merge conflict|fix conflicts/i, 'There are unresolved merge conflicts.'],
  [/your local changes to the following files would be overwritten/i, 'Local changes would be overwritten. Commit or stash them first.'],
  [/index\.lock.*file exists|unable to create .*index\.lock/i, 'Another Git process is running (index.lock exists).'],
  [/authentication failed|could not read username|permission denied \(publickey\)/i, 'Authentication failed.'],
  [/could not resolve host|unable to access|connection (timed out|refused)/i, 'The remote cannot be reached.'],
  [/does not have any commits|unknown revision or path|bad revision|ambiguous argument/i, 'That revision does not exist.'],
  [/nothing to commit/i, 'Nothing to commit.'],
];

/** One-line message for git's stderr: the matching rule's text, else the first non-empty line without colour codes. */
export function humanizeGitError(stderr: string): string {
  const text = stderr.replace(ANSI, '');
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? 'Git failed.'
  );
}

/** Operation markers in the git dir, most specific first. */
export const IN_PROGRESS_MARKERS: Array<['rebase' | 'merge' | 'cherry-pick' | 'revert' | 'bisect', string]> = [
  ['rebase', 'rebase-merge'],
  ['rebase', 'rebase-apply'],
  ['merge', 'MERGE_HEAD'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD'],
  ['bisect', 'BISECT_LOG'],
];
