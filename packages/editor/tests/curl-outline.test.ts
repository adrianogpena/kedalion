import { describe, expect, test } from 'bun:test';
import { curlBodyRange, curlOutline, curlVariables, formatCurlBody, quoteCurlBody } from '../src/curl-outline.ts';

const FILE = `# Collection: x
# Converted from x.postman_collection.json

# orders / items / Get item
# disabled header: A: b
curl --location --request GET '{{local}}/items/1' \\
  --header 'A: b'

# Create order
curl --location '{{local}}/orders' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{"a":1,"b":[1,2]}'

curl https://x.test/plain
`;

describe('curlOutline', () => {
  const items = curlOutline(FILE);

  test('names, folders, methods and urls', () => {
    expect(items.map((i) => [i.folder.join('/'), i.name, i.method, i.url])).toEqual([
      ['orders/items', 'Get item', 'GET', '{{local}}/items/1'],
      ['', 'Create order', 'POST', '{{local}}/orders'],
      ['', 'GET https://x.test/plain', 'GET', 'https://x.test/plain'],
    ]);
  });

  test('line, ranges and header count', () => {
    expect(items.map((i) => i.line)).toEqual([6, 10, 14]);
    expect(FILE.slice(items[0]!.from, items[0]!.to).startsWith('curl --location --request GET')).toBe(true);
    expect(items[1]!.headers).toBe(1);
  });
});

describe('curlVariables', () => {
  test('counts uses, most used first', () => {
    expect(curlVariables('{{a}} {{b}} {{a}}')).toEqual([
      { name: 'a', count: 2, builtin: false },
      { name: 'b', count: 1, builtin: false },
    ]);
  });
});

describe('formatCurlBody', () => {
  test('pretty-prints a JSON body and keeps the rest', () => {
    const out = formatCurlBody(`curl -X POST 'u' --data-raw '{"a":1}' --compressed`);
    expect(out).toBe(`curl -X POST 'u' --data-raw '{\n  "a": 1\n}' --compressed`);
  });

  test('null when not JSON or already formatted', () => {
    expect(formatCurlBody(`curl -d 'a=b' u`)).toBeNull();
    expect(formatCurlBody(`curl -d '{\n  "a": 1\n}' u`)).toBeNull();
    expect(formatCurlBody('curl u')).toBeNull();
  });
});

describe('curlBodyRange', () => {
  test('range of the quoted body, and quoting', () => {
    const cmd = `curl -X POST 'u' --data-raw '{"a":1}' --compressed`;
    const r = curlBodyRange(cmd)!;
    expect(cmd.slice(r.from, r.to)).toBe('{"a":1}');
    expect(quoteCurlBody("it's")).toBe("it'\''s");
  });

  test('null without exactly one data flag', () => {
    expect(curlBodyRange(`curl -d 'a' -d 'b' u`)).toBeNull();
    expect(curlBodyRange('curl u')).toBeNull();
  });
});
