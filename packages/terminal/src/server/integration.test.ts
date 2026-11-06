import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureIntegrationFiles, integratedShell, integrationFiles, withIntegration } from './integration.ts';

describe('integratedShell', () => {
  test('uses the profile shell, or the executable name for auto', () => {
    expect(integratedShell('git-bash', ['C:\\Git\\bin\\bash.exe'])).toBe('git-bash');
    expect(integratedShell('auto', ['/usr/bin/zsh', '-l'])).toBe('zsh');
    expect(integratedShell('auto', ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'])).toBe('powershell');
    expect(integratedShell('auto', ['/bin/sh'])).toBeNull();
    expect(integratedShell('wsl', ['wsl.exe'])).toBeNull();
    expect(integratedShell('custom', ['/bin/bash'])).toBeNull();
  });
});

describe('withIntegration', () => {
  const dir = '/data/si';
  test('bash drops login flags and loads the rcfile', () => {
    expect(withIntegration('bash', ['/bin/bash', '-l', '--norc'], dir, {}).argv).toEqual(['/bin/bash', '--rcfile', '/data/si/bash.sh', '--norc', '-i']);
  });
  test('zsh gets a ZDOTDIR and keeps the user one', () => {
    const r = withIntegration('zsh', ['/bin/zsh', '-l'], dir, { ZDOTDIR: '/home/me/.config/zsh' });
    expect(r.argv).toEqual(['/bin/zsh', '-l']);
    expect(r.env).toEqual({ ZDOTDIR: join(dir, 'zsh'), KEDALION_USER_ZDOTDIR: '/home/me/.config/zsh' });
  });
  test('fish, pwsh and cmd', () => {
    expect(withIntegration('fish', ['/bin/fish'], dir, {}).argv.slice(1, 2)).toEqual(['--init-command']);
    const ps = withIntegration('pwsh', ['pwsh', '-NoLogo'], "/it's", {}).argv;
    expect(ps.slice(0, 4)).toEqual(['pwsh', '-NoLogo', '-NoExit', '-Command']);
    expect(ps[4]).toContain("it''s");
    expect(withIntegration('cmd', ['cmd.exe'], dir, { PROMPT: '$G' }).env.PROMPT).toContain('$E]133;A$E\\$G$E]133;B$E\\');
  });
  test('the kedalion prompt sets the spec and symbol, or a PROMPT for cmd', () => {
    expect(withIntegration('bash', ['/bin/bash'], dir, {}, { prompt: 'kedalion' }).env).toEqual({ KEDALION_PROMPT: 'cwd:36 branch:35 status:31 symbol:32:31', KEDALION_PROMPT_SYMBOL: '$' });
    expect(withIntegration('bash', ['/bin/bash'], dir, {}, { prompt: 'kedalion', style: { segments: [], symbol: '>' } }).env.KEDALION_PROMPT).toBe('-');
    expect(withIntegration('bash', ['/bin/bash'], dir, {}, { prompt: 'shell' }).env).toEqual({});
    const fns = withIntegration('bash', ['/bin/bash'], dir, {}, { prompt: 'kedalion', style: { segments: [{ kind: 'custom', name: 'jdkinfo' }], symbol: '$', customs: [{ name: 'jdkinfo', script: 'echo j' }, { name: 'off', script: 'echo o' }] } }).env;
    expect(fns.KEDALION_PROMPT_FN_jdkinfo).toBe('echo j');
    expect(fns.KEDALION_PROMPT_FN_off).toBeUndefined();
    const cmd = withIntegration('cmd', ['cmd.exe'], dir, { PROMPT: '$G' }, { prompt: 'kedalion', style: { segments: [{ kind: 'cwd', color: 'cyan' }, { kind: 'branch' }, { kind: 'newline' }, { kind: 'symbol', color: 'green' }], symbol: '$' } }).env;
    expect(cmd.KEDALION_PROMPT).toBeUndefined();
    expect(cmd.PROMPT).toContain('$E[36m$P$E[0m$_$E[32m$$$E[0m $E]133;B');
  });
});

describe('integration files', () => {
  test('are written with LF endings (CRLF for PowerShell)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-si-'));
    ensureIntegrationFiles(dir);
    expect(Object.keys(integrationFiles()).sort()).toEqual(['bash.sh', 'fish.fish', 'pwsh.ps1', 'zsh/.zlogin', 'zsh/.zprofile', 'zsh/.zshenv', 'zsh/.zshrc']);
    const bash = readFileSync(join(dir, 'bash.sh'), 'utf8');
    expect(bash).not.toContain('\r');
    expect(bash).toContain('133;C');
    expect(readFileSync(join(dir, 'pwsh.ps1'), 'utf8')).toContain('\r\n');
    expect(readFileSync(join(dir, 'zsh', '.zprofile'), 'utf8')).toContain('$ZDOTDIR/.zprofile');
  });
});
