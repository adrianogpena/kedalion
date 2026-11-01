import { expect, test } from 'bun:test';
import { browserArgs, parsePortFile } from './launch.ts';

test('browserArgs builds the headless command line', () => {
  const args = browserArgs({ profileDir: '/p', allowOrigin: 'http://127.0.0.1:9' });
  expect(args).toEqual([
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=/p',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=http://127.0.0.1:9',
  ]);
});

test('parsePortFile reads port and ws path', () => {
  expect(parsePortFile('1234\r\n/devtools/browser/abc\r\n')).toEqual({ port: 1234, wsPath: '/devtools/browser/abc' });
  expect(parsePortFile('1234\n/devtools/browser/abc')).toEqual({ port: 1234, wsPath: '/devtools/browser/abc' });
});

test('parsePortFile rejects partial or bad content', () => {
  expect(parsePortFile('')).toBeNull();
  expect(parsePortFile('1234\n')).toBeNull();
  expect(parsePortFile('abc\n/x')).toBeNull();
  expect(parsePortFile('0\n/x')).toBeNull();
});
