import { describe, expect, test } from 'bun:test';
import { DEFAULT_PROMPT_STYLE, promptPreview, promptSpec, validPromptStyle, type PromptSample } from './prompt.ts';

const sample: PromptSample = { cwd: '~/src/app', folder: 'app', branch: 'main', user: 'me', host: 'pc', time: '09:30', gitstatus: '*', os: 'Linux', shell: 'bash', date: '2026-11-05', duration: '3s', jobs: '1', venv: '.venv', node: 'node 22', java: 'jdk-21', status: 0 };
const text = (lines: { text: string }[][]) => lines.map((l) => l.map((s) => s.text).join(''));

describe('validPromptStyle', () => {
  test('keeps a valid style and drops unknown keys', () => {
    expect(validPromptStyle({ segments: [{ kind: 'cwd', color: 'cyan', bold: false, x: 1 }, { kind: 'newline' }, { kind: 'newline' }], symbol: '$' })).toEqual({
      segments: [{ kind: 'cwd', color: 'cyan' }, { kind: 'newline' }, { kind: 'newline' }],
      symbol: '$',
    });
    expect(validPromptStyle(DEFAULT_PROMPT_STYLE)).toEqual(DEFAULT_PROMPT_STYLE);
  });
  test('rejects unknown kinds and colors, duplicates, and bad symbols', () => {
    expect(validPromptStyle({ segments: [{ kind: 'git' }], symbol: '>' })).toBeNull();
    expect(validPromptStyle({ segments: [{ kind: 'cwd', color: 'pink' }], symbol: '>' })).toBeNull();
    expect(validPromptStyle({ segments: [{ kind: 'cwd' }, { kind: 'cwd' }], symbol: '>' })).toBeNull();
    expect(validPromptStyle({ segments: [], symbol: ' ' })).toBeNull();
    expect(validPromptStyle({ segments: [], symbol: 'a\x1bb' })).toBeNull();
    expect(validPromptStyle({ segments: [], symbol: '123456789' })).toBeNull();
  });
});

describe('promptSpec', () => {
  test('encodes kinds with SGR codes', () => {
    expect(promptSpec(DEFAULT_PROMPT_STYLE)).toBe('cwd:36 branch:35 status:31 symbol:32:31');
    expect(promptSpec({ segments: [{ kind: 'user', bold: true }, { kind: 'newline' }, { kind: 'symbol', color: 'brightBlue' }], symbol: '$' })).toBe('user:1;39 newline symbol:94:94');
  });
});

describe('promptPreview', () => {
  test('joins segments, skips an empty branch and a zero status, and colors the symbol by status', () => {
    expect(text(promptPreview(DEFAULT_PROMPT_STYLE, sample))).toEqual(['~/src/app main $ ']);
    const failed = promptPreview(DEFAULT_PROMPT_STYLE, { ...sample, branch: '', status: 2 });
    expect(text(failed)).toEqual(['~/src/app 2 $ ']);
    expect(failed[0]!.at(-2)).toEqual({ text: '$', color: 'red' });
  });
  test('splits lines at newline', () => {
    const style = { segments: [{ kind: 'user' as const }, { kind: 'newline' as const }, { kind: 'symbol' as const }], symbol: '$' };
    expect(text(promptPreview(style, sample))).toEqual(['me', '$ ']);
  });
});
