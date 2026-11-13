import { expect, test } from 'bun:test';
import { browserArgs, desktopUserAgent, parsePortFile } from './launch.ts';

test('browserArgs builds the headless command line', () => {
  const args = browserArgs({ profileDir: '/p', allowOrigin: 'http://127.0.0.1:9' });
  expect(args).toEqual([
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=/p',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=http://127.0.0.1:9',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1920,1080',
    '--screen-info={1920x1080}',
  ]);
  expect(browserArgs({ profileDir: '/p', allowOrigin: 'x', userAgent: 'UA' }).at(-1)).toBe('--user-agent=UA');
  expect(browserArgs({ profileDir: '/p', allowOrigin: 'x', userAgent: 'UA', hideAutomation: false })).toHaveLength(6);
});

test('desktopUserAgent drops the headless marker', () => {
  expect(desktopUserAgent(157, true, 'win32')).toBe(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  );
  expect(desktopUserAgent(157, false, 'linux')).not.toContain('Edg/');
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
