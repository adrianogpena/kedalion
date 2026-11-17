import { expect, test } from 'bun:test';
import { humanizeGitError } from './git-errors.ts';

test('humanizeGitError maps known stderr and falls back to the first line', () => {
  expect(humanizeGitError('fatal: Unable to create \'/r/.git/index.lock\': File exists.')).toBe('Another Git process is running (index.lock exists).');
  expect(humanizeGitError('\u001b[31m\u001b[0m\nfatal: something odd\nmore')).toBe('fatal: something odd');
});
