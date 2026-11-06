import { describe, expect, test } from 'bun:test';
import { DEFAULT_PROMPT_STYLE, promptSpec, validPromptStyle, type PromptStyle } from './prompt.ts';
import { parsePromptScript, promptScript } from './prompt-script.ts';

const custom: PromptStyle = {
  segments: [{ kind: 'user', color: 'green', bold: true }, { kind: 'cwd', color: 'cyan' }, { kind: 'custom', name: 'jdkinfo', color: 'yellow' }, { kind: 'newline' }, { kind: 'symbol', color: 'green', errorColor: 'red' }],
  symbol: "it's",
  customs: [{ name: 'jdkinfo', script: '  if [ -n "$JAVA_HOME" ]; then\n    echo "jdk ${JAVA_HOME##*/}"\n  else\n    echo none\n  fi' }, { name: 'unused', script: '  echo x' }],
};

describe('promptScript / parsePromptScript', () => {
  test('round-trip the default and a style with custom segments', () => {
    expect(parsePromptScript(promptScript(DEFAULT_PROMPT_STYLE))).toEqual({ style: DEFAULT_PROMPT_STYLE, errors: [] });
    expect(parsePromptScript(promptScript(custom))).toEqual({ style: custom, errors: [] });
  });
  test('reads export, double quotes, bare words and comments', () => {
    const r = parsePromptScript(['export PROMPT_SEGMENTS="cwd symbol" # order', 'PROMPT_SYMBOL=">"', 'PROMPT_COLOR_cwd=blue', '', '# note'].join('\n'));
    expect(r.style).toEqual({ segments: [{ kind: 'cwd', color: 'blue' }, { kind: 'symbol' }], symbol: '>' });
  });
  test('reports errors with their lines', () => {
    const r = parsePromptScript(['PROMPT_SEGMENTS="cwd jdkinfo cwd"', 'PROMPT_COLOR_cwd="pink"', 'PROMPT_COLOR_host=red', 'PROMPT_FOO=1', 'echo hi', 'prompt_x() {', '  echo'].join('\n'));
    expect(r.style).toBeNull();
    expect(r.errors).toEqual([
      { line: 1, code: 'unknownSegment', value: 'jdkinfo' },
      { line: 1, code: 'duplicateSegment', value: 'cwd' },
      { line: 2, code: 'unknownColor', value: 'pink' },
      { line: 3, code: 'colorOfUnused', value: 'PROMPT_COLOR_host' },
      { line: 4, code: 'unknownVariable', value: 'PROMPT_FOO' },
      { line: 5, code: 'syntax' },
      { line: 6, code: 'unclosedFunction', value: 'x' },
    ]);
  });
});

describe('custom segments', () => {
  test('validate against customs and encode their name', () => {
    expect(validPromptStyle(custom)).toEqual(custom);
    expect(validPromptStyle({ ...custom, customs: [] })).toBeNull();
    expect(validPromptStyle({ segments: [], symbol: '$', customs: [{ name: 'cwd', script: '' }] })).toBeNull();
    expect(promptSpec(custom)).toBe('user:1;32 cwd:36 custom:33:jdkinfo newline symbol:32:31');
  });
});
