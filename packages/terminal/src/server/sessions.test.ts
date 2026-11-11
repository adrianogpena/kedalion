import { describe, expect, test } from 'bun:test';
import type { Pty } from './pty.ts';
import { cwdFromOsc7, terminalSessions, type Sink } from './sessions.ts';

class FakePty implements Pty {
  written: Array<string | Uint8Array> = [];
  size = [0, 0];
  killed = false;
  private data: Array<(d: Uint8Array) => void> = [];
  private exit: Array<(c: number | null) => void> = [];
  write(d: string | Uint8Array) {
    this.written.push(d);
  }
  resize(c: number, r: number) {
    this.size = [c, r];
  }
  kill() {
    this.killed = true;
  }
  onData(cb: (d: Uint8Array) => void) {
    this.data.push(cb);
  }
  onExit(cb: (c: number | null) => void) {
    this.exit.push(cb);
  }
  emit(text: string) {
    for (const cb of this.data) cb(new TextEncoder().encode(text));
  }
  end(code: number | null) {
    for (const cb of this.exit) cb(code);
  }
}

class FakeSink implements Sink {
  frames: Array<string | Uint8Array> = [];
  closed = false;
  send(f: string | Uint8Array) {
    this.frames.push(f);
  }
  close() {
    this.closed = true;
  }
  get text() {
    return this.frames.map((f) => (typeof f === 'string' ? f : new TextDecoder().decode(f))).join('');
  }
  messages() {
    return this.frames.filter((f): f is string => typeof f === 'string' && f.startsWith('{')).map((f) => JSON.parse(f));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function setup(opts: { max?: number; now?: () => number } = {}) {
  const ptys: FakePty[] = [];
  const reg = terminalSessions({
    spawn: () => {
      const p = new FakePty();
      ptys.push(p);
      return p;
    },
    ...opts,
  });
  const make = (extra = {}) => reg.create({ cmd: ['sh'], cwd: '/tmp', cols: 80, rows: 24, label: 'sh', ...extra });
  return { reg, ptys, make };
}

describe('terminalSessions', () => {
  test('output while detached is replayed on attach, then live output follows', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('hello\r\n');
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    ptys[0]!.emit('live');
    await settle();
    expect(sink.messages()[0]).toEqual({ type: 'hello', session: s.id, cols: 80, rows: 24 });
    expect(sink.text).toContain('hello');
    expect(sink.text.endsWith('live')).toBe(true);
  });

  test('a second interactive attach closes the first, a preview does not', async () => {
    const { reg, make } = setup();
    const s = make();
    const a = new FakeSink();
    const b = new FakeSink();
    const p = new FakeSink();
    reg.attach(s.id, a, 'interactive');
    reg.attach(s.id, p, 'preview');
    expect(a.closed).toBe(false);
    reg.attach(s.id, b, 'interactive');
    await settle();
    expect(a.closed).toBe(true);
    expect(p.closed).toBe(false);
    expect(b.closed).toBe(false);
    expect(reg.list()[0]!.viewers).toEqual({ interactive: true, previews: 1 });
  });

  test('preview input and resize are ignored, interactive ones act', () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const i = new FakeSink();
    const p = new FakeSink();
    reg.attach(s.id, i, 'interactive');
    reg.attach(s.id, p, 'preview');
    reg.write(s.id, p, 'x');
    reg.resize(s.id, p, 10, 10);
    reg.close(s.id, p);
    expect(ptys[0]!.written).toEqual([]);
    expect(ptys[0]!.size).toEqual([0, 0]);
    expect(reg.get(s.id)).toBeDefined();
    reg.write(s.id, i, 'y');
    reg.resize(s.id, i, 100, 30);
    expect(ptys[0]!.written).toEqual(['y']);
    expect(ptys[0]!.size).toEqual([100, 30]);
    expect(reg.list()[0]).toMatchObject({ cols: 100, rows: 30 });
  });

  test('exit while detached is reported on attach', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.end(3);
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    expect(sink.messages().filter((m) => m.type === 'exit')).toEqual([{ type: 'exit', code: 3 }]);
    expect(reg.list()[0]!.exited).toBe(3);
  });

  test('exit is sent once to attached sinks and the session stays until close', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    ptys[0]!.end(0);
    await settle();
    expect(sink.messages().filter((m) => m.type === 'exit')).toEqual([{ type: 'exit', code: 0 }]);
    expect(reg.get(s.id)).toBeDefined();
  });

  test('close kills, closes sinks and removes; closeAll kills all', () => {
    const { reg, ptys, make } = setup();
    const a = make();
    const b = make();
    const sink = new FakeSink();
    reg.attach(a.id, sink, 'interactive');
    reg.close(a.id);
    expect(ptys[0]!.killed).toBe(true);
    expect(sink.closed).toBe(true);
    expect(reg.get(a.id)).toBeUndefined();
    reg.closeAll();
    expect(ptys[1]!.killed).toBe(true);
    expect(reg.get(b.id)).toBeUndefined();
    expect(reg.list()).toEqual([]);
  });

  test('refuses a session beyond max', () => {
    const { make } = setup({ max: 2 });
    make();
    make();
    expect(() => make()).toThrow(expect.objectContaining({ code: 'terminalLimit' }));
  });

  test('headless answers queries only while no interactive client is attached', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('\x1b[6n');
    await settle();
    expect(ptys[0]!.written.length).toBe(1);
    reg.attach(s.id, new FakeSink(), 'interactive');
    ptys[0]!.emit('\x1b[6n');
    await settle();
    expect(ptys[0]!.written.length).toBe(1);
  });

  test('replay restores the alternate screen without the queries', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('\x1b[?1049h\x1b[Halt\x1b[6n');
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'preview');
    await settle();
    expect(sink.text).toContain('\x1b[?1049h');
    expect(sink.text).not.toContain('\x1b[6n');
  });
});

describe('session info', () => {
  test('title, bells and lastOutputAt', async () => {
    let t = 1000;
    const { reg, ptys, make } = setup({ now: () => t });
    const s = make({ launcher: 'claude', meta: { id: 'abc' } });
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    expect(reg.list()[0]).toMatchObject({ label: 'sh', launcher: 'claude', meta: { id: 'abc' }, cwd: '/tmp', createdAt: 1000, lastOutputAt: 1000, bells: 0, title: '' });
    t = 2000;
    ptys[0]!.emit('\x1b]0;x\x07\x07');
    await settle();
    expect(reg.list()[0]).toMatchObject({ title: 'x', bells: 1, lastOutputAt: 2000 });
    expect(sink.messages()).toContainEqual({ type: 'title', title: 'x' });
  });

  test('oversized meta is refused', () => {
    const { reg, make } = setup();
    expect(() => make({ meta: { big: 'x'.repeat(5000) } })).toThrow(expect.objectContaining({ code: 'terminalMeta' }));
    const s = make();
    expect(() => reg.setMeta(s.id, { big: 'x'.repeat(5000) })).toThrow(expect.objectContaining({ code: 'terminalMeta' }));
  });

  test('setLabel and setMeta show in list()', () => {
    const { reg, make } = setup();
    const s = make();
    reg.setLabel(s.id, 'renamed');
    reg.setMeta(s.id, { a: 1 });
    expect(reg.list()[0]).toMatchObject({ label: 'renamed', meta: { a: 1 } });
  });
});

describe('session reaping', () => {
  test('an exited session is removed once its last viewer detaches', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    ptys[0]!.end(0);
    await settle();
    expect(reg.list()).toHaveLength(1);
    reg.detach(s.id, sink);
    expect(reg.list()).toHaveLength(0);
  });

  test('exited sessions without viewers do not count toward the limit', () => {
    const { ptys, make } = setup({ max: 1 });
    make();
    ptys[0]!.end(0);
    expect(() => make()).not.toThrow();
  });

  test('output that overflows the terminal closes the session', () => {
    const { reg, ptys, make } = setup();
    make();
    const sink = new FakeSink();
    reg.attach(reg.list()[0]!.id, sink, 'interactive');
    const big = new Uint8Array(1 << 20).fill(65);
    expect(() => {
      for (let i = 0; i < 80; i++) ptys[0]!.emit(new TextDecoder().decode(big));
    }).not.toThrow();
    expect(reg.list()).toHaveLength(0);
    expect(sink.closed).toBe(true);
  });
});

describe('shell integration', () => {
  test('cwdFromOsc7 decodes file URLs and Windows drive paths', () => {
    expect(cwdFromOsc7('file://host/home/me/a%20b')).toBe('/home/me/a b');
    expect(cwdFromOsc7('file://PC/C:/Users/me')).toBe('C:\\Users\\me');
    expect(cwdFromOsc7('file://localhost/C:\\Work dir')).toBe('C:\\Work dir');
    expect(cwdFromOsc7('file://localhost/D:')).toBe('D:\\');
    expect(cwdFromOsc7('file://host/100%')).toBe('/100%');
    expect(cwdFromOsc7('http://x/y')).toBeNull();
    expect(cwdFromOsc7('file://host')).toBeNull();
  });

  test('OSC 7 updates cwd and OSC 133 C/D track running; profile and shell are listed', async () => {
    const { reg, ptys } = setup();
    const s = reg.create({ cmd: ['bash'], cwd: '/start', cols: 80, rows: 24, label: 'b', profile: 'bash', shell: 'bash' });
    expect(reg.list()[0]).toMatchObject({ cwd: '/start', profile: 'bash', shell: 'bash', running: undefined });
    ptys[0]!.emit('\x1b]7;file://h/tmp/x\x07\x1b]133;A\x07$ \x1b]133;B\x07');
    await settle();
    expect(reg.list()[0]).toMatchObject({ cwd: '/tmp/x', running: false });
    ptys[0]!.emit('\x1b]133;C\x07');
    await settle();
    expect(reg.list()[0]!.running).toBe(true);
    ptys[0]!.emit('\x1b]133;D;1\x1b\\');
    await settle();
    expect(reg.list()[0]!.running).toBe(false);
    reg.close(s.id);
  });
});

const osc = (body: string) => `\x1b]${body}\x07`;
const prompt = `${osc('133;A')}$ ${osc('133;B')}`;

describe('session model', () => {
  test('commands from OSC 633 E, or typed after the prompt, with their output and exit code', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const p = ptys[0]!;
    p.emit(`${prompt}npm test\r\n${osc('633;E;npm test')}${osc('133;C')}ok 1\r\nok 2\r\n${osc('133;D;1')}`);
    p.emit(`${prompt}ls -la\r\n${osc('133;C')}a.txt\r\n${osc('133;D;0')}${prompt}`);
    await settle();
    const cmds = reg.commands(s.id);
    expect(cmds.map((c) => [c.command, c.exitCode])).toEqual([
      ['npm test', 1],
      ['ls -la', 0],
    ]);
    expect(reg.commandOutput(s.id, cmds[0]!.id)).toEqual({ text: 'ok 1\nok 2', truncated: false });
    expect(reg.history.list().map((h) => h.command)).toEqual(['ls -la', 'npm test']);
    reg.close(s.id);
  });

  test('results and trigger captures come from output lines only, not the typed command', async () => {
    const notices: string[] = [];
    const { reg, ptys } = setup();
    const r2 = terminalSessions({ spawn: () => ptys[ptys.push(new FakePty()) - 1]!, notify: (n) => notices.push(n.body) });
    r2.configure({ triggers: [{ id: 't', name: 'boom', pattern: 'ERROR', action: 'notify' }] });
    const s = r2.create({ cmd: ['sh'], cwd: '/tmp', cols: 80, rows: 24, label: 'sh' });
    const p = ptys[ptys.length - 1]!;
    p.emit(`${prompt}gh pr view https://github.com/a/b/pull/1\r\n${osc('133;C')}https://github.com/a/b/pull/2\r\nERROR bad\r\n${osc('133;D;0')}${prompt}`);
    await settle();
    expect(r2.results(s.id).map((r) => r.title)).toEqual(['a/b#2']);
    expect(r2.captures(s.id).map((c) => c.text)).toEqual(['ERROR bad']);
    expect(notices).toEqual(['boom: ERROR bad']);
    r2.closeAll();
    reg.closeAll();
  });

  test('a long command notifies only when its terminal is not seen; the finish alert always does, once', async () => {
    let t = 0;
    const notices: string[] = [];
    const ptys: FakePty[] = [];
    const reg = terminalSessions({ spawn: () => ptys[ptys.push(new FakePty()) - 1]!, now: () => t, notify: (n) => notices.push(n.body) });
    reg.configure({ notifyAfter: 10 });
    const s = reg.create({ cmd: ['sh'], cwd: '/tmp', cols: 80, rows: 24, label: 'sh' });
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    const run = async (cmd: string, secs: number) => {
      ptys[0]!.emit(`${prompt}${cmd}\r\n${osc('133;C')}`);
      await settle();
      t += secs * 1000;
      ptys[0]!.emit(`${osc('133;D;0')}`);
      await settle();
    };
    await run('seen', 20);
    reg.setVisible(s.id, sink, false);
    await run('hidden', 20);
    await run('short', 1);
    reg.setVisible(s.id, sink, true);
    reg.setAlerts(s.id, { finish: true });
    await run('alerted', 1);
    await run('after', 1);
    expect(notices).toEqual(['hidden succeeded after 20s', 'alerted succeeded after 1s']);
    expect(reg.alerts(s.id).finish).toBe(false);
    reg.closeAll();
  });

  test('lines that leave the scrollback are kept and searchable', async () => {
    const dir = `${require('node:os').tmpdir()}/kedalion-earlier-test-${process.pid}`;
    const ptys: FakePty[] = [];
    const reg = terminalSessions({ spawn: () => ptys[ptys.push(new FakePty()) - 1]!, earlierDir: dir });
    const s = reg.create({ cmd: ['sh'], cwd: '/tmp', cols: 80, rows: 24, label: 'sh' });
    let out = '';
    for (let i = 0; i < 7000; i++) out += `line number ${i}\r\n`;
    ptys[0]!.emit(out);
    await settle();
    const found = await reg.earlier(s.id, 'line number 12');
    expect(found.hits.some((h) => h.line === 'line number 12')).toBe(true);
    ptys[0]!.emit('wiped secret\r\n\x1b[2J\x1b[3J');
    await settle();
    expect((await reg.earlier(s.id, 'wiped secret')).count).toBe(1);
    reg.closeAll();
    expect(require('node:fs').existsSync(dir + `/${s.id}.txt`)).toBe(false);
  });
});
