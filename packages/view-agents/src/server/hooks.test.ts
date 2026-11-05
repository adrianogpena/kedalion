import { expect, test } from 'bun:test';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import type { AgentsSettings } from '../settings-types.ts';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHookSettings, createHookApprovals, createHooks, hookKey } from './hooks.ts';
import { createTransitions } from './notify.ts';

const sess = (id: string, status: AgentStatus) => ({ id, status, title: id, firstPrompt: '', cwd: '/p', project: 'pr' }) as AgentSessionView;

const all = { isApproved: async () => true };

function setup(cfg: AgentsSettings, fail = false, approvals: { isApproved(c: string): Promise<boolean> } = all) {
  const runs: Array<{ command: string; env: Record<string, string> }> = [];
  const flashes: string[] = [];
  const h = createHooks(
    {
      settings: async () => cfg,
      flash: (title, body) => flashes.push(`${title}: ${body}`),
      approvals,
      spawn: async (command, o) => {
        if (fail) throw new Error('boom');
        runs.push({ command, env: o.env });
      },
    },
    createTransitions(),
  );
  return { h, runs, flashes };
}

test('maps statuses to hooks by category', () => {
  expect(['starting', 'running', 'needs-you', 'done', 'error', 'exited', 'idle', 'stopped'].map((s) => hookKey(s as AgentStatus))).toEqual(['onRunning', 'onRunning', 'onWaiting', 'onDone', 'onError', 'onError', undefined, undefined]);
});

test('first sight is silent, transitions run once with env, blank is off', async () => {
  const { h, runs } = setup({ 'hooks.onWaiting': '  echo w ', 'hooks.onDone': '   ', 'hooks.onRunning': 'echo r' });
  await h.observe([sess('a', 'idle')]);
  await h.observe([sess('a', 'running'), sess('b', 'needs-you')]);
  await h.observe([sess('a', 'running')]);
  await h.observe([sess('a', 'needs-you'), sess('b', 'done')]);
  await h.observe([sess('a', 'needs-you')]);
  await h.observe([sess('a', 'idle')]);
  expect(runs.map((r) => r.command)).toEqual(['echo r', 'echo w']);
  expect(runs[0]!.env).toMatchObject({ KEDALION_SESSION_ID: 'a', KEDALION_STATUS: 'running', KEDALION_PROJECT: 'pr', KEDALION_CWD: '/p' });
});

test('a session that leaves and returns is first sight again', async () => {
  const { h, runs } = setup({ 'hooks.onRunning': 'x' });
  await h.observe([sess('a', 'idle')]);
  await h.observe([]);
  await h.observe([sess('a', 'running')]);
  expect(runs).toEqual([]);
});

test('start failure flashes once per run', async () => {
  const { h, flashes } = setup({ 'hooks.onRunning': 'x' }, true);
  await h.observe([sess('a', 'idle')]);
  await h.observe([sess('a', 'running')]);
  await Bun.sleep(5);
  expect(flashes).toEqual(['Hook failed to start: boom']);
});

test('an unapproved command is not spawned and flashes once; an approved one runs', async () => {
  const { h, runs, flashes } = setup({ 'hooks.onRunning': 'evil', 'hooks.onWaiting': 'good' }, false, { isApproved: async (c) => c === 'good' });
  await h.observe([sess('a', 'idle'), sess('b', 'idle')]);
  await h.observe([sess('a', 'running'), sess('b', 'needs-you')]);
  await h.observe([sess('a', 'idle'), sess('b', 'idle')]);
  await h.observe([sess('a', 'running'), sess('b', 'idle')]);
  expect(runs.map((r) => r.command)).toEqual(['good']);
  expect(flashes).toEqual(['Hook not approved: Edit and apply it in Settings > Agents to confirm it']);
});

function store() {
  const file = join(mkdtempSync(join(tmpdir(), 'hooks-')), 'approved-hooks.json');
  return { file, approvals: createHookApprovals(() => file) };
}

test('an unapproved hook asks once and is stored, even when unchanged; an approved one does not ask', async () => {
  const { file, approvals } = store();
  const asked: string[] = [];
  const confirm = async (o: { message: string }) => (asked.push(o.message), true);
  await checkHookSettings({ agents: { 'hooks.onDone': ' notify done ' } }, {}, { approvals, confirm });
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('notify done');
  expect(await approvals.isApproved('notify done')).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).sha256).toHaveLength(1);
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  await checkHookSettings({ agents: { 'hooks.onError': 'notify done', 'hooks.onRunning': 'old' } }, { agents: { 'hooks.onRunning': 'old' } }, { approvals, confirm });
  expect(asked).toHaveLength(2);
  expect(asked[1]).toContain('old');
  await checkHookSettings({ agents: { 'hooks.onRunning': 'old' } }, { agents: { 'hooks.onRunning': 'old' } }, { approvals, confirm });
  expect(asked).toHaveLength(2);
});

test('a denied hook rejects the save and stores nothing', async () => {
  const { approvals } = store();
  const err = await checkHookSettings({ agents: { 'hooks.onRunning': 'x' } }, {}, { approvals, confirm: async () => false }).catch((e) => e);
  expect(err).toMatchObject({ code: 'hookNotApproved', kind: 'invalid' });
  expect(await approvals.isApproved('x')).toBe(false);
});
