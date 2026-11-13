import { expect, test } from 'bun:test';
import { areaOf, clean, cleanText, hostOf, redactCredentials, safeUrl, shellArea } from './classify.ts';
import { parseTrace } from './trace.ts';
import { shortModel } from '../protocol.ts';

test('shellArea reads commands behind wrappers, subcommands and PowerShell names', () => {
  expect(shellArea('ls -la && cat a.txt | grep x')).toBe('files');
  expect(shellArea('bun test')).toBe('shell');
  expect(shellArea('git status')).toBe('shell');
  expect(shellArea('git -C repo push origin main')).toBe('web');
  expect(shellArea('sudo -u me curl https://x.io')).toBe('web');
  expect(shellArea('timeout 5 env A=1 wget x')).toBe('web');
  expect(shellArea('echo $(gh pr list)')).toBe('web');
  expect(shellArea('python -m pip install foo')).toBe('web');
  expect(shellArea('npx tsc')).toBe('shell');
  expect(shellArea('npx -y create-thing')).toBe('web');
  expect(shellArea('find . -name x -exec rm {} \\;')).toBe('files');
  expect(shellArea('rtk bypass grep -n x a.ts')).toBe('files');
  expect(shellArea('"C:\\Program Files\\curl\\CURL.EXE" -s x')).toBe('web');
  expect(shellArea('Get-Content a.txt | Select-String x', true)).toBe('files');
  expect(shellArea('$r = Invoke-WebRequest https://x.io', true)).toBe('web');
  expect(shellArea('cat ~/.claude-personal/projects/p/memory/MEMORY.md')).toBe('memory');
});

test('areaOf maps tools and MCP servers', () => {
  expect(areaOf('Read', { file_path: 'C:\\Users\\me\\.claude\\projects\\p\\memory\\x.md' })).toBe('memory');
  expect(areaOf('Edit', { file_path: '/src/a.ts' })).toBe('files');
  expect(areaOf('Agent', {})).toBe('agents');
  expect(areaOf('Skill', {})).toBe('skills');
  expect(areaOf('AskUserQuestion', {})).toBe('you');
  expect(areaOf('TodoWrite', {})).toBe('model');
  expect(areaOf('mcp__kedalion-browser__browser_click', {})).toBe('browser');
  expect(areaOf('mcp__my-memory__recall', {})).toBe('memory');
  expect(areaOf('mcp__claude_ai_Gmail__send_message', {})).toBe('web');
});

test('hostOf and safeUrl keep credentials and queries out', () => {
  expect(hostOf('https://user:pa/ss@example.com/x?q=1')).toBe('example.com');
  expect(hostOf('https://example.com:8080/a')).toBe('example.com:8080');
  expect(safeUrl('https://u:p@example.com/a/b?token=x#f')).toBe('https://example.com/a/b?…');
  expect(safeUrl('https://example.com')).toBe('https://example.com');
  expect(redactCredentials('git clone https://me:tok@github.com/a/b')).toBe('git clone https://***@github.com/a/b');
});

test('clean drops control characters and direction marks', () => {
  expect(clean('a\u202eb\u0007c\nd')).toBe('ab c d');
  expect(cleanText('x\u2066y\n\tz\u0000')).toBe('xy\n\tz');
});

test('shortModel', () => {
  expect(shortModel('claude-opus-5-5')).toBe('opus 5.5');
  expect(shortModel('claude-fable-5-2-20261001')).toBe('fable 5.2');
  expect(shortModel('gpt-x')).toBe('gpt-x');
});

test('parseTrace sets area, safe labels and model changes', () => {
  const j = (o: unknown) => JSON.stringify(o);
  const steps = parseTrace(
    [
      j({ type: 'user', message: { content: 'go' } }),
      j({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://u:p@x.io/a?k=s' } }] } }),
      j({ type: 'assistant', message: { id: 'm2', model: 'claude-fable-5-2', content: [{ type: 'text', text: 'done' }] } }),
    ].join('\n'),
  );
  expect(steps[1]!.area).toBe('web');
  expect(steps[1]!.label).toBe('WebFetch(https://x.io/a?…)');
  expect(steps[1]!.modelFrom).toBeUndefined();
  expect(steps[2]!.modelFrom).toBe('claude-opus-5-5');
});
