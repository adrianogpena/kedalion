import { describe, expect, test } from 'bun:test';
import { createFakeClient } from './fake.ts';
import { createInterceptor, matchRule, patternMatches } from './intercept.ts';

describe('patternMatches', () => {
  test('without * the URL only has to contain the text', () => {
    expect(patternMatches('/api/users', 'https://x.test/api/users?id=1')).toBe(true);
    expect(patternMatches('/api/orders', 'https://x.test/api/users')).toBe(false);
  });

  test('* matches any text and the whole URL', () => {
    expect(patternMatches('https://x.test/*.png', 'https://x.test/a/b.png')).toBe(true);
    expect(patternMatches('https://x.test/*.png', 'https://x.test/a/b.png?v=1')).toBe(false);
    expect(patternMatches('*', 'https://x.test/')).toBe(true);
  });

  test('regex characters in the pattern are literal', () => {
    expect(patternMatches('a.b*', 'aXb/1')).toBe(false);
    expect(patternMatches('a.b*', 'a.b/1')).toBe(true);
  });
});

describe('matchRule', () => {
  const rules = [
    { id: '1', enabled: false, pattern: '/api', action: 'block' as const },
    { id: '2', enabled: true, pattern: '/api', action: 'mock' as const },
  ];
  test('skips disabled rules', () => {
    expect(matchRule(rules, 'https://x.test/api')?.id).toBe('2');
  });
});

describe('createInterceptor', () => {
  test('blocks, mocks and continues requests', () => {
    const fake = createFakeClient();
    const i = createInterceptor(fake.session('s'), [
      { id: 'a', enabled: true, pattern: '/blocked', action: 'block' },
      { id: 'b', enabled: true, pattern: '/mocked', action: 'mock', status: 404, body: 'x' },
    ]);
    expect(fake.methods('s')).toEqual(['Fetch.enable']);
    for (const [requestId, path] of [['1', 'blocked'], ['2', 'mocked'], ['3', 'other']] as const) {
      fake.emit('Fetch.requestPaused', { requestId, request: { url: `https://x.test/${path}` } }, 's');
    }
    expect(fake.methods('s').slice(1)).toEqual(['Fetch.failRequest', 'Fetch.fulfillRequest', 'Fetch.continueRequest']);
    expect(fake.calls.find((c) => c.method === 'Fetch.fulfillRequest')?.params.responseCode).toBe(404);
    i.setRules([]);
    expect(fake.methods('s').at(-1)).toBe('Fetch.disable');
  });
});
