import { expect, test } from 'bun:test';
import { browserSettingsOf, validBrowser } from './settings.ts';

test('validBrowser accepts fitting values', () => {
  expect(validBrowser({ executable: 'C:\\b.exe', ignoreLocalCertErrors: true, agentTools: false, home: 'https://a.b' })).toEqual({
    executable: 'C:\\b.exe',
    ignoreLocalCertErrors: true,
    agentTools: false,
    home: 'https://a.b',
  });
  expect(validBrowser({ agentTools: false })).toEqual({ agentTools: false });
});

test('validBrowser rejects wrong types and unknown keys', () => {
  expect(validBrowser({ agentTools: 'yes' })).toBeNull();
  expect(validBrowser({ home: 3 })).toBeNull();
  expect(validBrowser({ other: true })).toBeNull();
  expect(validBrowser('x')).toBeNull();
});

test('browserSettingsOf fills defaults', () => {
  expect(browserSettingsOf(undefined)).toEqual({ executable: '', ignoreLocalCertErrors: false, agentTools: true, home: 'about:blank' });
  expect(browserSettingsOf({ browser: { home: '' } }).home).toBe('about:blank');
});
