import { describe, expect, test } from 'bun:test';
import { exportCurl } from '../src/curl-export.ts';
import { parseCurl } from '../src/http-import.ts';

const request = parseCurl(`curl --location --request POST 'https://x.test/a' --header 'Content-Type: application/json' --header 'X-A: it'\\''s' --data-raw '{"a":1}'`);

describe('exportCurl', () => {
  test('fetch', () => {
    expect(exportCurl(request, 'fetch')).toBe(
      'const response = await fetch("https://x.test/a", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-A": "it\'s",\n  },\n  body: JSON.stringify({\n    "a": 1\n  }),\n});\nconsole.log(response.status, await response.text());\n',
    );
  });

  test('powershell', () => {
    expect(exportCurl(request, 'powershell')).toBe(
      "$headers = @{\n  'X-A' = 'it''s'\n}\n\n$body = @'\n{\"a\":1}\n'@\n\nInvoke-RestMethod -Method Post -Uri 'https://x.test/a' `\n  -Headers $headers `\n  -ContentType 'application/json' `\n  -Body $body\n",
    );
  });

  test('http', () => {
    expect(exportCurl(request, 'http')).toBe('POST https://x.test/a\nContent-Type: application/json\nX-A: it\'s\n\n{"a":1}\n');
  });

  test('GET has no body', () => {
    expect(exportCurl(parseCurl("curl 'https://x.test/'"), 'http')).toBe('GET https://x.test/\n');
  });
});
