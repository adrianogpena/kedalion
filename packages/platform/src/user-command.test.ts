import { expect, test } from 'bun:test';
import { buildUserCommand } from './user-command.ts';

test('a whole-argument list marker expands to several arguments', () => {
  expect(buildUserCommand(['git', 'branch', '-d', '{{branches}}'], { branches: ['a', 'b'] })).toEqual(['git', 'branch', '-d', 'a', 'b']);
  expect(buildUserCommand(['x', '{{branches}}'], { branches: [] })).toEqual(['x']);
});

test('markers inside text join lists and replace in one pass', () => {
  expect(buildUserCommand(['--names={{branches}}', '{{a}}-{{b}}'], { branches: ['p', 'q'], a: '{{b}}', b: 'z' })).toEqual(['--names=p q', '{{b}}-z']);
});

test('unknown markers stay', () => {
  expect(buildUserCommand(['{{nope}}', 'a{{nope}}'], {})).toEqual(['{{nope}}', 'a{{nope}}']);
});
