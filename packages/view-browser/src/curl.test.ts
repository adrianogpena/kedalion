import { describe, expect, test } from 'bun:test';
import { toCurl } from './curl';

describe('toCurl', () => {
  test('GET without body', () => {
    expect(toCurl({ method: 'GET', url: 'https://x.test/a', headers: { Accept: '*/*', Host: 'x.test' } })).toBe(`curl 'https://x.test/a' -H 'Accept: */*'`);
  });

  test('POST with a body and a quote inside', () => {
    expect(toCurl({ method: 'POST', url: 'https://x.test/a', headers: {}, body: `it's` })).toBe(`curl 'https://x.test/a' -X POST --data-raw 'it'\\''s'`);
  });
});
