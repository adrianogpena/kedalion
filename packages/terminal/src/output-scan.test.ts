import { describe, expect, test } from 'bun:test';
import { compileTriggers, detectResults, findLinks, validTriggers, type ScanState } from './output-scan.ts';
import { parseOsc633Command } from './shell-integration.ts';

describe('detectResults', () => {
  test('pull requests, issues and new-PR links', () => {
    const s: ScanState = {};
    expect(detectResults('https://github.com/acme/app/pull/42', s)).toEqual([{ kind: 'pr', url: 'https://github.com/acme/app/pull/42', title: 'acme/app#42' }]);
    expect(detectResults('see https://gitlab.example.com/g/p/-/issues/7.', s)[0]).toMatchObject({ kind: 'issue', title: 'g/p#7' });
    expect(detectResults('remote:   https://github.com/acme/app/pull/new/feat-x', s)[0]).toMatchObject({ kind: 'newPr', detail: 'feat-x' });
  });

  test('local apps use localhost for any interface', () => {
    expect(detectResults('  ➜  Local:   http://0.0.0.0:5173/', {})).toEqual([{ kind: 'app', url: 'http://localhost:5173/', title: 'localhost:5173' }]);
  });

  test('a commit line', () => {
    expect(detectResults('[main 1a2b3c4] Fix the thing', {})).toEqual([{ kind: 'commit', url: null, title: 'Fix the thing', detail: 'main', hash: '1a2b3c4' }]);
  });

  test('a push across lines', () => {
    const s: ScanState = {};
    expect(detectResults('To github.com:acme/app.git', s)).toEqual([]);
    expect(detectResults('   1a2b3c4..5d6e7f8  main -> main', s)).toEqual([{ kind: 'push', url: 'https://github.com/acme/app/tree/main', title: 'acme/app main', detail: 'main' }]);
    detectResults('done', s);
    expect(s.push).toBeUndefined();
  });
});

describe('findLinks', () => {
  test('paths with line numbers, urls and hashes without overlap', () => {
    const links = findLinks('src/app/main.ts:12:3 failed; see https://x.dev/a/b and C:\\work\\a.ts(4,2) at 1a2b3c4d');
    expect(links.map((l) => [l.kind, l.text, l.line])).toEqual([
      ['path', 'src/app/main.ts', 12],
      ['url', 'https://x.dev/a/b', undefined],
      ['path', 'C:\\work\\a.ts', 4],
      ['hash', '1a2b3c4d', undefined],
    ]);
  });

  test('fractions, dates and plain numbers are not links', () => {
    expect(findLinks('1/2 of 2024/01/02 took 1234567 ms')).toEqual([]);
  });
});

describe('triggers', () => {
  test('validTriggers rejects bad patterns and unknown keys', () => {
    expect(validTriggers([{ id: 'a', pattern: 'ERR', action: 'notify' }])).not.toBeNull();
    expect(validTriggers([{ id: 'a', pattern: '(', action: 'notify' }])).toBeNull();
    expect(validTriggers([{ id: 'a', pattern: 'x', action: 'beep' }])).toBeNull();
    expect(validTriggers([{ id: 'a', pattern: 'x', action: 'highlight', color: 'red' }])).toBeNull();
    expect(validTriggers([{ id: 'a', pattern: 'x', action: 'capture', extra: 1 }])).toBeNull();
  });

  test('compileTriggers skips disabled ones and is case-insensitive by default', () => {
    const list = compileTriggers([
      { id: 'a', pattern: 'error', action: 'capture' },
      { id: 'b', pattern: 'x', action: 'capture', enabled: false },
    ]);
    expect(list.length).toBe(1);
    expect(list[0].re.test('ERROR here')).toBe(true);
  });
});

test('parseOsc633Command unescapes VS Code escaping', () => {
  expect(parseOsc633Command('E;echo a\\x3bb\\\\c\\x0ad')).toBe('echo a;b\\c\nd');
  expect(parseOsc633Command('A')).toBeNull();
});
