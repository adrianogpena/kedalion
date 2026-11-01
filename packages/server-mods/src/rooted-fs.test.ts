import { afterEach, expect, test } from 'bun:test';
import { symlinkSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformError } from '@kedalion/platform';
import type { RouteContext } from '@kedalion/server-core';
import { pickedPaths } from './dialogs.ts';
import { type FsEntry, parseExclude, rootedFs, searchTree, sortEntries } from './rooted-fs.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const OLD = new Date('2020-01-01T00:00:00Z');

async function setup(opts: { maxReadBytes?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'kedalion-fs-'));
  dirs.push(base);
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(join(root, 'a'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'a', 'b.txt'), 'hello\nsecond line');
  await utimes(join(root, 'a', 'b.txt'), OLD, OLD);
  await writeFile(join(root, 'top.txt'), 'top');
  await writeFile(join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, join(root, 'link'), 'junction');
  const trashed: string[][] = [];
  const fs = rootedFs({
    roots: async () => [
      { id: 'r', path: root },
      { id: 'ro', path: root, readOnly: true },
    ],
    trash: async (paths) => {
      trashed.push(paths);
    },
    ...opts,
  });
  const call = async (key: string, input: string | Record<string, unknown>) => {
    const ctx = {
      req: new Request('http://x/'),
      query: new URLSearchParams(typeof input === 'string' ? input : ''),
      json: async () => input,
    } as unknown as RouteContext;
    return fs.routes[key]!(ctx);
  };
  const fail = (key: string, input: string | Record<string, unknown>) => call(key, input).catch((e) => e);
  return { root, outside, realRoot: await realpath(root), fs, call, fail, trashed };
}

const lines = async (res: unknown) => (await (res as Response).text()).trim().split('\n').map((l) => JSON.parse(l));

const ESCAPES = ['../x', 'a/../../x', 'C:\\x', '\\\\srv\\s', '/x', 'CON', 'con.txt', 'a:b', 'x.'];

test('resolve refuses escapes and odd names, accepts paths inside the root', async () => {
  const { fs, realRoot } = await setup();
  for (const rel of ESCAPES) expect(await fs.resolve('r', rel).catch((e) => e)).toMatchObject({ kind: 'invalid', code: 'badPath' });
  expect(await fs.resolve('r', 'link/secret.txt').catch((e) => e)).toMatchObject({ kind: 'forbidden', code: 'outsideRoot', status: 403 });
  expect(await fs.resolve('r', 'link').catch((e) => e)).toMatchObject({ code: 'outsideRoot' });

  expect((await fs.resolve('r', 'a/b.txt')).real).toBe(join(realRoot, 'a', 'b.txt'));
  expect((await fs.resolve('r', 'a\\.\\b.txt')).real).toBe(join(realRoot, 'a', 'b.txt'));
  expect(await fs.resolve('r', '')).toMatchObject({ abs: realRoot, real: realRoot, root: { id: 'r' } });
  expect((await fs.resolve('r', 'new/dir/file.txt')).real).toBe(join(realRoot, 'new', 'dir', 'file.txt'));
  expect(await fs.resolve('r', 'new/file.txt', { mustExist: true }).catch((e) => e)).toMatchObject({ code: 'fileNotFound' });
  expect(await fs.resolve('nope', '').catch((e) => e)).toMatchObject({ kind: 'notfound', code: 'rootNotFound' });
});

test('a dangling link is refused: where it points cannot be checked', async () => {
  const { root, fs } = await setup();
  symlinkSync(join(root, '..', 'outside', 'gone'), join(root, 'dangling'), 'junction');
  expect(await fs.resolve('r', 'dangling/new.txt').catch((e) => e)).toMatchObject({ code: 'outsideRoot' });
});

test('list puts folders first and marks links that leave the root', async () => {
  const { root, call } = await setup();
  symlinkSync(join(root, 'a'), join(root, 'a-link'), 'junction');
  const { entries } = (await call('GET /api/fs/list', 'root=r')) as { entries: FsEntry[] };
  expect(entries.map(({ name, kind, outside, target, external }) => ({ name, kind, outside, target, external }))).toEqual([
    { name: 'a', kind: 'dir', outside: undefined, target: undefined, external: undefined },
    { name: 'a-link', kind: 'link', outside: undefined, target: 'dir', external: undefined },
    { name: 'link', kind: 'link', outside: undefined, target: 'dir', external: true },
    { name: 'top.txt', kind: 'file', outside: undefined, target: undefined, external: undefined },
  ]);
  expect(entries[3]).toMatchObject({ size: 3, mtime: expect.any(Number) });
  expect(await call('GET /api/fs/stat', 'root=r&path=a/b.txt')).toEqual({ name: 'b.txt', kind: 'file', size: 17, mtime: OLD.getTime() });
});

test('read routes follow a link out of the root, read-only; writes are refused', async () => {
  const { call } = await setup();
  const { entries } = (await call('GET /api/fs/list', 'root=r&path=link')) as { entries: FsEntry[] };
  expect(entries).toEqual([expect.objectContaining({ name: 'secret.txt', kind: 'file', readOnly: true })]);
  expect(await call('GET /api/fs/read', 'root=r&path=link/secret.txt')).toMatchObject({ text: 'secret', readOnly: true });
  expect(await call('GET /api/fs/stat', 'root=r&path=link/secret.txt')).toMatchObject({ name: 'secret.txt', readOnly: true });
  await expect(call('POST /api/fs/create', { root: 'r', path: 'link/new.txt', kind: 'file' })).rejects.toMatchObject({ code: 'outsideRoot' });
});

test('read gives text, truncated text or binary', async () => {
  const { root, call } = await setup({ maxReadBytes: 3 });
  expect(await call('GET /api/fs/read', 'root=r&path=top.txt')).toEqual({ text: 'top', encoding: 'utf8', size: 3, mtime: expect.any(Number), truncated: false });
  expect(await call('GET /api/fs/read', 'root=r&path=a/b.txt')).toMatchObject({ text: 'hel', size: 17, truncated: true });
  await writeFile(join(root, 'bin.dat'), new Uint8Array([1, 0, 2]));
  expect(await call('GET /api/fs/read', 'root=r&path=bin.dat')).toMatchObject({ binary: true, size: 3 });
});

test('read and write keep the encoding: BOMs, UTF-16 and Windows-1252', async () => {
  const { root, call, fail } = await setup();
  const cases: Array<[string, number[], string]> = [
    ['utf8bom', [0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9], 'hé'],
    ['utf16le', [0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00], 'hé'],
    ['utf16be', [0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9], 'hé'],
    ['windows1252', [0x68, 0xe9, 0x80], 'hé€'],
  ];
  for (const [encoding, bytes, text] of cases) {
    await writeFile(join(root, `${encoding}.txt`), new Uint8Array(bytes));
    expect(await call('GET /api/fs/read', `root=r&path=${encoding}.txt`)).toMatchObject({ text, encoding });
    await call('POST /api/fs/write', { root: 'r', path: `${encoding}.txt`, text, encoding });
    expect([...(await readFile(join(root, `${encoding}.txt`)))]).toEqual(bytes);
  }
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'windows1252.txt', text: '日本', encoding: 'windows1252' })).toMatchObject({ code: 'unencodable' });
  expect([...(await readFile(join(root, 'windows1252.txt')))]).toEqual([0x68, 0xe9, 0x80]);
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'top.txt', text: 'x', encoding: 'ebcdic' })).toMatchObject({ code: 'badRequest' });
});

test('raw serves the bytes with a type by extension and nosniff', async () => {
  const { call, fail } = await setup();
  const res = (await call('GET /api/fs/raw', 'root=r&path=top.txt')) as Response;
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await res.text()).toBe('top');
  expect(await fail('GET /api/fs/raw', 'root=r&path=a')).toMatchObject({ code: 'notAFile' });
});

test('write checks the mtime, creates new files and needs the parent', async () => {
  const { root, call, fail } = await setup();
  const entry = (await call('POST /api/fs/write', { root: 'r', path: 'a/b.txt', text: 'bye', expectedMtime: OLD.getTime() })) as FsEntry;
  expect(entry).toMatchObject({ name: 'b.txt', kind: 'file', size: 3 });
  expect(await readFile(join(root, 'a', 'b.txt'), 'utf8')).toBe('bye');
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'a/b.txt', text: 'x', expectedMtime: OLD.getTime() })).toMatchObject({
    code: 'fileChanged',
  });
  await call('POST /api/fs/write', { root: 'r', path: 'a/new.txt', text: 'n' });
  expect(await readFile(join(root, 'a', 'new.txt'), 'utf8')).toBe('n');
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'missing/x.txt', text: 'x' })).toMatchObject({ code: 'fileNotFound' });
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'a', text: 'x' })).toMatchObject({ code: 'notAFile' });
});

test('read marks read-only files; write refuses them unless asked to unlock', async () => {
  const { root, call, fail } = await setup();
  const file = join(root, 'top.txt');
  expect(await call('GET /api/fs/read', 'root=r&path=top.txt')).not.toHaveProperty('readOnly');
  expect(await call('GET /api/fs/read', 'root=ro&path=top.txt')).toMatchObject({ readOnly: true });
  await chmod(file, 0o444);
  expect(await call('GET /api/fs/read', 'root=r&path=top.txt')).toMatchObject({ readOnly: true });
  expect(await fail('POST /api/fs/write', { root: 'r', path: 'top.txt', text: 'x' })).toMatchObject({ code: 'fileReadOnly' });
  expect(await readFile(file, 'utf8')).toBe('top');
  await call('POST /api/fs/write', { root: 'r', path: 'top.txt', text: 'x', unlock: true });
  expect(await readFile(file, 'utf8')).toBe('x');
  expect((await stat(file)).mode & 0o200).not.toBe(0);
});

test('copy', async () => {
  const { root, call, fail } = await setup();
  await call('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file', text: 'c' });
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a/c.txt', to: 'a/c.txt' })).toMatchObject({ name: 'c copy.txt' });
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a/c.txt', to: 'a/c.txt' })).toMatchObject({ name: 'c copy 2.txt' });
  expect(await readFile(join(root, 'a', 'c copy.txt'), 'utf8')).toBe('c');
  expect(await call('POST /api/fs/copy', { root: 'r', from: 'a', to: 'a2' })).toMatchObject({ name: 'a2', kind: 'dir' });
  expect(await readFile(join(root, 'a2', 'c.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/copy', { root: 'r', from: 'a', to: 'a/x' })).toMatchObject({ code: 'moveIntoSelf' });
});

test('create, rename and move', async () => {
  const { root, call, fail } = await setup();
  await call('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file', text: 'c' });
  expect(await fail('POST /api/fs/create', { root: 'r', path: 'a/c.txt', kind: 'file' })).toMatchObject({ code: 'exists' });
  expect(await call('POST /api/fs/create', { root: 'r', path: 'd/e', kind: 'dir' })).toMatchObject({ name: 'e', kind: 'dir' });
  expect(await fail('POST /api/fs/create', { root: 'r', path: 'd/e', kind: 'dir' })).toMatchObject({ code: 'exists' });

  expect(await call('POST /api/fs/rename', { root: 'r', path: 'a/c.txt', name: 'c2.txt' })).toMatchObject({ name: 'c2.txt' });
  expect(await readFile(join(root, 'a', 'c2.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: 'x/y' })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: '..' })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: 'a/c2.txt', name: 'b.txt' })).toMatchObject({ code: 'exists' });
  expect(await fail('POST /api/fs/rename', { root: 'r', path: '', name: 'x' })).toMatchObject({ code: 'badPath' });

  expect(await call('POST /api/fs/move', { root: 'r', from: 'a/c2.txt', to: 'd/c2.txt' })).toMatchObject({ name: 'c2.txt', kind: 'file' });
  expect(await readFile(join(root, 'd', 'c2.txt'), 'utf8')).toBe('c');
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'd', to: 'd/e/d' })).toMatchObject({ code: 'moveIntoSelf' });
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'd/c2.txt', to: 'a/b.txt' })).toMatchObject({ code: 'exists' });
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'gone.txt', to: 'a/x.txt' })).toMatchObject({ code: 'fileNotFound' });
});

test('delete hands the real paths to the trash in one call', async () => {
  const { realRoot, call, fail, trashed } = await setup();
  expect(await call('POST /api/fs/delete', { root: 'r', paths: ['a/b.txt', 'top.txt', 'a', 'top.txt'] })).toEqual({ ok: true });
  expect(trashed).toEqual([[join(realRoot, 'top.txt'), join(realRoot, 'a')]]);
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: [''] })).toMatchObject({ code: 'badPath' });
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: [] })).toMatchObject({ code: 'badRequest' });
  expect(await fail('POST /api/fs/delete', { root: 'r', paths: Array(1001).fill('top.txt') })).toMatchObject({ code: 'tooManyItems' });
});

test('move onto an existing name keeps both or replaces through the trash', async () => {
  const { root, realRoot, call, trashed } = await setup();
  await writeFile(join(root, 'a', 'top.txt'), 'old');
  const kept = await call('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', onExisting: 'keepBoth' });
  expect(kept).toMatchObject({ name: 'top copy.txt' });
  expect(await readFile(join(root, 'a', 'top copy.txt'), 'utf8')).toBe('top');
  await writeFile(join(root, 'top.txt'), 'new');
  await call('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', onExisting: 'replace' });
  expect(trashed).toEqual([[join(realRoot, 'a', 'top.txt')]]);
});

test('multiDelete off refuses more than one path', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kedalion-fs-'));
  dirs.push(base);
  const fs = rootedFs({ roots: async () => [{ id: 'r', path: base }], trash: async () => {}, multiDelete: false });
  await writeFile(join(base, 'f.txt'), 'x');
  const run = (paths: string[]) => Promise.resolve(fs.routes['POST /api/fs/delete']!({ json: async () => ({ root: 'r', paths }) } as unknown as RouteContext)).catch((e) => e);
  expect(await run(['f.txt', 'g.txt'])).toMatchObject({ code: 'multiDeleteOff' });
  expect(await run(['f.txt'])).toEqual({ ok: true });
});

test('a trash failure reaches the client as its PlatformError code', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kedalion-fs-'));
  dirs.push(base);
  await writeFile(join(base, 'f.txt'), 'x');
  const fs = rootedFs({
    roots: async () => [{ id: 'r', path: base }],
    trash: async () => {
      throw new PlatformError('trashFailed', 'nope', 'detail');
    },
  });
  const ctx = { json: async () => ({ root: 'r', paths: ['f.txt'] }) } as unknown as RouteContext;
  expect(await Promise.resolve(fs.routes['POST /api/fs/delete']!(ctx)).catch((e) => e)).toMatchObject({ code: 'trashFailed', opts: { detail: 'detail' } });
});

test('sqlite lists tables and pages rows, refusing a file that is no database', async () => {
  const { call, fail, root } = await setup();
  const { Database } = await import('bun:sqlite');
  const db = new Database(join(root, 'app.db'));
  db.run('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, photo BLOB)');
  db.run('CREATE TABLE "my table"(x)');
  for (let i = 0; i < 250; i++) db.run('INSERT INTO people (name, photo) VALUES (?, ?)', [`n${i}`, i === 0 ? new Uint8Array(3) : null]);
  db.close();
  const first = (await call('GET /api/fs/sqlite', 'root=r&path=app.db')) as { tables: { name: string }[]; table: string; columns: string[]; rows: unknown[][]; total: number };
  expect(first.tables.map((t) => t.name)).toEqual(['my table', 'people']);
  expect(first.table).toBe('my table');
  const people = (await call('GET /api/fs/sqlite', 'root=r&path=app.db&table=people&offset=200')) as typeof first;
  expect(people).toMatchObject({ table: 'people', columns: ['id', 'name', 'photo'], total: 250, offset: 200 });
  expect(people.rows).toHaveLength(50);
  const head = (await call('GET /api/fs/sqlite', 'root=r&path=app.db&table=people')) as typeof first;
  expect(head.rows[0]).toEqual([1, 'n0', '<blob 3 bytes>']);
  expect(await fail('GET /api/fs/sqlite', 'root=r&path=top.txt')).toMatchObject({ code: 'notSqlite' });
  expect(await fail('GET /api/fs/sqlite', 'root=r&path=../x')).toMatchObject({ code: 'badPath' });
});

test('raw with limit returns only the first bytes', async () => {
  const { call } = await setup();
  const res = (await call('GET /api/fs/raw', 'root=r&path=top.txt&limit=2')) as Response;
  expect(await res.text()).toBe('to');
});

test('every route refuses escapes', async () => {
  const { fail, trashed } = await setup();
  for (const [rel, code] of [
    ['../x', 'badPath'],
    ['link/secret.txt', 'outsideRoot'],
  ] as const) {
    const q = `root=r&path=${encodeURIComponent(rel)}`;
    if (code === 'badPath') {
      for (const key of ['GET /api/fs/list', 'GET /api/fs/stat', 'GET /api/fs/read', 'GET /api/fs/raw', 'GET /api/fs/search']) {
        expect(await fail(key, q)).toMatchObject({ code });
      }
    }
    expect(await fail('POST /api/fs/write', { root: 'r', path: rel, text: 'x' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/create', { root: 'r', path: rel, kind: 'file' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/rename', { root: 'r', path: rel, name: 'y' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/move', { root: 'r', from: rel, to: 'a/y' })).toMatchObject({ code });
    expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: rel })).toMatchObject({ code });
    expect(await fail('POST /api/fs/delete', { root: 'r', paths: ['top.txt', rel] })).toMatchObject({ code });
  }
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', toRoot: 'nope' })).toMatchObject({ code: 'rootNotFound' });
  expect(trashed).toEqual([]);
});

test('a read-only root refuses every write', async () => {
  const { fail, trashed } = await setup();
  for (const [key, body] of [
    ['POST /api/fs/write', { path: 'top.txt', text: 'x' }],
    ['POST /api/fs/create', { path: 'n.txt', kind: 'file' }],
    ['POST /api/fs/rename', { path: 'top.txt', name: 'y.txt' }],
    ['POST /api/fs/move', { from: 'top.txt', to: 'a/top.txt' }],
    ['POST /api/fs/delete', { paths: ['top.txt'] }],
  ] as const) {
    expect(await fail(key, { root: 'ro', ...body })).toMatchObject({ kind: 'forbidden', code: 'rootReadOnly' });
  }
  expect(await fail('POST /api/fs/move', { root: 'r', from: 'top.txt', to: 'a/top.txt', toRoot: 'ro' })).toMatchObject({ code: 'rootReadOnly' });
  expect(trashed).toEqual([]);
});

test('search streams name and content hits, never through links', async () => {
  const { root, call } = await setup();
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules', 'b-hello.txt'), 'hello');
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=B'))).toEqual([{ path: 'a/b.txt', kind: 'file' }, { $end: true }]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=line&content=1'))).toEqual([
    { path: 'a/b.txt', kind: 'file', line: 2, text: 'second line' },
    { $end: true },
  ]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&path=a&q=&glob=*.txt'))).toEqual([{ path: 'a/b.txt', kind: 'file' }, { $end: true }]);
  expect(await lines(await call('GET /api/fs/search', 'root=r&q=secret&content=1'))).toEqual([{ $end: true }]);
});

test('search stops once aborted', async () => {
  const { root } = await setup();
  for (let i = 0; i < 10; i++) await writeFile(join(root, `hit${i}.txt`), 'x');
  const ac = new AbortController();
  const hits = searchTree({ abs: root, rel: '' }, { q: 'hit', content: false, glob: null }, ac.signal);
  expect((await hits.next()).value).toEqual({ path: 'hit0.txt', kind: 'file' });
  ac.abort();
  expect((await hits.next()).done).toBe(true);
});

const tailSetup = async (content: string | Buffer) => {
  const t = await setup();
  const picks = { opened: pickedPaths(), saveTargets: pickedPaths() };
  const fs = rootedFs({ roots: async () => [{ id: 'r', path: t.root }], picks });
  await writeFile(join(t.root, 'x.log'), content);
  const call = (key: string, input: string | Record<string, unknown>) =>
    fs.routes[key]!({
      req: new Request('http://x/'),
      query: new URLSearchParams(typeof input === 'string' ? input : ''),
      json: async () => input,
    } as unknown as RouteContext);
  return { ...t, picks, call, fail: (key: string, input: string | Record<string, unknown>) => Promise.resolve(call(key, input)).catch((e: unknown) => e) };
};

test('tail reads whole lines and keeps the unterminated last line as partial', async () => {
  const { call } = await tailSetup('one\ntwo\nthr');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=0')).toMatchObject({ from: 0, to: 8, size: 11, text: 'one\ntwo\n', partial: 'thr' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=4')).toMatchObject({ from: 4, to: 8, text: 'two\n', partial: 'thr' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=11')).toMatchObject({ from: 11, to: 11, text: '' });
});

test('tail without from drops the cut first line', async () => {
  const { call } = await tailSetup('aaaa\nbbbb\ncccc\n');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=8')).toMatchObject({ from: 10, to: 15, text: 'cccc\n' });
});

test('tail reports reset when from is past the end', async () => {
  const { call } = await tailSetup('abc\n');
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&from=99')).toMatchObject({ reset: true, from: 4, to: 4, text: '' });
});

test('tail advances through one line longer than max', async () => {
  const { call } = await tailSetup('x'.repeat(3000));
  const chunk = (await call('GET /api/fs/tail', 'root=r&path=x.log&from=0&max=1000')) as { to: number; text: string; partial?: string };
  expect(chunk.to).toBe(1000);
  expect(chunk.text).toHaveLength(1000);
  expect(chunk.partial).toBeUndefined();
});

test('tail clamps max, refuses bad input, outside paths and binary files', async () => {
  const { call, fail, root } = await tailSetup('abc\n');
  await writeFile(join(root, 'b.bin'), Buffer.from([1, 0, 2]));
  expect(await fail('GET /api/fs/tail', 'root=r&path=x.log&from=1.5')).toMatchObject({ code: 'badRequest' });
  expect(await fail('GET /api/fs/tail', 'root=r&path=x.log&max=abc')).toMatchObject({ code: 'badRequest' });
  expect(await call('GET /api/fs/tail', 'root=r&path=link/secret.txt')).toMatchObject({ partial: 'secret' });
  expect(await fail('GET /api/fs/tail', 'root=r&path=b.bin')).toMatchObject({ code: 'notText' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=999999999')).toMatchObject({ text: 'abc\n' });
  expect(await call('GET /api/fs/tail', 'root=r&path=x.log&max=0')).toMatchObject({ size: 4 });
});

test('save-range writes the bytes after the bookmark to the picked target', async () => {
  const t = await tailSetup('hello world\n');
  const target = join(t.root, 'out.log');
  t.picks.saveTargets.add(target);
  expect(await t.call('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 6, target })).toEqual({ path: target, bytes: 6 });
  expect(await readFile(target, 'utf8')).toBe('world\n');
});

test('save-range refuses a target no dialog picked and stale or bad offsets', async () => {
  const t = await tailSetup('abc\n');
  const target = join(t.root, 'out.log');
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 0, target })).toMatchObject({ code: 'notASaveTarget' });
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 0 })).toMatchObject({ code: 'notASaveTarget' });
  t.picks.saveTargets.add(target);
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: 99, target })).toMatchObject({ code: 'rangeStale' });
  expect(await t.fail('POST /api/fs/save-range', { root: 'r', path: 'x.log', from: -1, target })).toMatchObject({ code: 'badRequest' });
});

test('save-new writes the text to the picked target once', async () => {
  const t = await tailSetup('');
  const target = join(t.outside, 'note.md');
  t.picks.saveTargets.add(target);
  expect(await t.call('POST /api/fs/save-new', { text: '# hi\n', target })).toEqual({ path: target });
  expect(await readFile(target, 'utf8')).toBe('# hi\n');
  expect(await t.fail('POST /api/fs/save-new', { text: 'again', target })).toMatchObject({ code: 'notASaveTarget' });
});

test('save-new with a path an earlier save returned writes there and refuses relative paths', async () => {
  const t = await tailSetup('');
  const target = join(t.outside, 'kept.txt');
  t.picks.saveTargets.add(target);
  expect(await t.call('POST /api/fs/save-new', { text: 'v1', target })).toEqual({ path: target });
  expect(await t.call('POST /api/fs/save-new', { text: 'v2', path: target })).toEqual({ path: target });
  expect(await readFile(target, 'utf8')).toBe('v2');
  expect(await t.fail('POST /api/fs/save-new', { text: 'x', path: 'rel.txt' })).toMatchObject({ code: 'badRequest' });
});

test('save-new with a path no dialog returned is refused and never written', async () => {
  const t = await tailSetup('');
  const elsewhere = join(t.outside, 'sub', 'evil.txt');
  expect(await t.fail('POST /api/fs/save-new', { text: 'x', path: elsewhere })).toMatchObject({ code: 'notASaveTarget' });
  expect(await t.fail('POST /api/fs/save-new', { text: 'x', target: elsewhere })).toMatchObject({ code: 'notASaveTarget' });
  expect(await readFile(elsewhere, 'utf8').catch(() => null)).toBeNull();
});

const uploader = (t: Awaited<ReturnType<typeof setup>>) => (query: string, body = 'x', headers: Record<string, string> = {}) =>
  Promise.resolve(
    t.fs.routes['POST /api/fs/upload']!({ req: new Request('http://x/', { method: 'POST', body, headers }), query: new URLSearchParams(query), json: async () => ({}) } as unknown as RouteContext),
  ).catch((e) => e);

test('upload streams the body to a new file, making missing folders', async () => {
  const t = await setup();
  const up = uploader(t);
  expect(await up('root=r&path=new/deep/f.txt', 'bytes')).toMatchObject({ name: 'f.txt', kind: 'file', size: 5 });
  expect(await readFile(join(t.root, 'new', 'deep', 'f.txt'), 'utf8')).toBe('bytes');
  expect(await up('root=r&path=empty.txt', '')).toMatchObject({ size: 0 });
});

test('upload refuses a taken name unless asked to replace or keep both', async () => {
  const t = await setup();
  const upload = uploader(t);
  expect(await upload('root=r&path=top.txt', 'new')).toMatchObject({ code: 'exists' });
  expect(await readFile(join(t.root, 'top.txt'), 'utf8')).toBe('top');
  expect(await upload('root=r&path=top.txt&onExisting=keepBoth', 'new')).toMatchObject({ name: 'top copy.txt' });
  expect(await readFile(join(t.root, 'top copy.txt'), 'utf8')).toBe('new');
  expect(await upload('root=r&path=top.txt&onExisting=replace', 'newer')).toMatchObject({ name: 'top.txt', size: 5 });
  expect(await readFile(join(t.root, 'top.txt'), 'utf8')).toBe('newer');
  expect(t.trashed).toEqual([[join(t.realRoot, 'top.txt')]]);
  expect(await upload('root=r&path=a&onExisting=replace')).toMatchObject({ code: 'notAFile' });
});

test('upload stays inside a writable root and refuses a body over the cap', async () => {
  const upload = uploader(await setup());
  expect(await upload('root=r&path=link/x.txt')).toMatchObject({ code: 'outsideRoot' });
  expect(await upload('root=r&path=../x.txt')).toMatchObject({ code: 'badPath' });
  expect(await upload('root=ro&path=x.txt')).toMatchObject({ code: 'rootReadOnly' });
  expect(await upload('root=r&path=x.txt&onExisting=bogus')).toMatchObject({ code: 'badRequest' });
  expect(await upload('root=r&path=big.txt', 'x', { 'content-length': '200000001' })).toMatchObject({ code: 'uploadTooLarge' });
});

test('download serves a file once, for the ticket from download-ticket', async () => {
  const t = await setup();
  const { ticket, name } = (await t.call('POST /api/fs/download-ticket', { root: 'r', path: 'a/b.txt' })) as { ticket: string; name: string };
  expect(name).toBe('b.txt');
  const get = (q: string) =>
    Promise.resolve(t.fs.openRoutes['GET /api/fs/download']!({ req: new Request('http://x/'), query: new URLSearchParams(q), json: async () => ({}) } as unknown as RouteContext));
  const res = (await get(`t=${ticket}`)) as Response;
  expect(await res.text()).toBe('hello\nsecond line');
  expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''b.txt");
  expect(await get(`t=${ticket}`).catch((e) => e)).toMatchObject({ code: 'invalidTicket' });
  expect(await get('').catch((e) => e)).toMatchObject({ code: 'invalidTicket' });
});

test('download-ticket refuses folders, missing files and paths outside the root', async () => {
  const t = await setup();
  expect(await t.fail('POST /api/fs/download-ticket', { root: 'r', path: 'a' })).toMatchObject({ code: 'notAFile' });
  expect(await t.fail('POST /api/fs/download-ticket', { root: 'r', path: '' })).toMatchObject({ code: 'notAFile' });
  expect(await t.fail('POST /api/fs/download-ticket', { root: 'r', path: 'nope.txt' })).toMatchObject({ code: 'fileNotFound' });
  expect(await t.fail('POST /api/fs/download-ticket', { root: 'r', path: 'link/secret.txt' })).toMatchObject({ code: 'outsideRoot' });
});

test('exclude globs match the path at any depth', () => {
  const globs = parseExclude(JSON.stringify(['**/.git', 'dist/*.map']));
  expect(globs.some((g) => g.match('.git'))).toBe(true);
  expect(globs.some((g) => g.match('a/b/.git'))).toBe(true);
  expect(globs.some((g) => g.match('dist/x.map'))).toBe(true);
  expect(globs.some((g) => g.match('src/x.map'))).toBe(false);
  expect(parseExclude('nope')).toEqual([]);
});

test('sortEntries orders by the chosen mode', () => {
  const e = (name: string, kind: 'file' | 'dir', mtime: number): FsEntry => ({ name, kind, size: 0, mtime });
  const make = () => [e('b.txt', 'file', 1), e('a.md', 'file', 3), e('z', 'dir', 2), e('c.md', 'file', 2)];
  const names = (sort: Parameters<typeof sortEntries>[1]) => {
    const list = make();
    sortEntries(list, sort);
    return list.map((x) => x.name);
  };
  expect(names('default')).toEqual(['z', 'a.md', 'b.txt', 'c.md']);
  expect(names('mixed')).toEqual(['a.md', 'b.txt', 'c.md', 'z']);
  expect(names('filesFirst')).toEqual(['a.md', 'b.txt', 'c.md', 'z']);
  expect(names('type')).toEqual(['z', 'a.md', 'c.md', 'b.txt']);
  expect(names('modified')).toEqual(['z', 'a.md', 'c.md', 'b.txt']);
});

test('info describes a file, a folder and the root; refuses escapes', async () => {
  const { call, fail, realRoot } = await setup();
  const file = (await call('GET /api/fs/info', 'root=r&path=a/b.txt')) as Record<string, unknown>;
  expect(file).toMatchObject({ name: 'b.txt', fullPath: join(realRoot, 'a', 'b.txt'), type: 'file', size: 17, modified: OLD.getTime(), readOnly: false });
  expect(file.created === null || typeof file.created === 'number').toBe(true);
  expect(await call('GET /api/fs/info', 'root=r&path=a')).toMatchObject({ type: 'dir', size: 0 });
  expect(await call('GET /api/fs/info', 'root=ro&path=')).toMatchObject({ fullPath: realRoot, readOnly: true });
  expect(await fail('GET /api/fs/info', 'root=r&path=../x')).toMatchObject({ code: 'badPath' });
  expect(await call('GET /api/fs/info', 'root=r&path=link/secret.txt')).toMatchObject({ name: 'secret.txt', readOnly: true });
});

test('du totals files, folders and bytes and skips links', async () => {
  const { call, fail, root } = await setup();
  await mkdir(join(root, 'a', 'c'));
  await writeFile(join(root, 'a', 'c', 'd.bin'), '12345');
  try {
    symlinkSync(join(root, 'a'), join(root, 'a', 'c', 'loop'), 'junction');
  } catch {}
  const out = await lines(await call('GET /api/fs/du', 'root=r&path=a'));
  expect(out.at(-1)).toEqual({ $end: true });
  expect(out.at(-2)).toEqual({ files: 2, dirs: 1, bytes: 22, done: true });
  const all = await lines(await call('GET /api/fs/du', 'root=r&path='));
  expect(all.at(-2)).toEqual({ files: 3, dirs: 2, bytes: 25, done: true });
  expect(await fail('GET /api/fs/du', 'root=r&path=../x')).toMatchObject({ code: 'badPath' });
});

test('hash streams a SHA-256 of the file', async () => {
  const { call, fail } = await setup();
  expect(await call('GET /api/fs/hash', 'root=r&path=top.txt')).toEqual({
    sha256: '28720365c5e7476a011e4f43ac003ee5f16247a263b9d623aa85ed311d73bf39',
  });
  expect(await fail('GET /api/fs/hash', 'root=r&path=a')).toMatchObject({ code: 'notAFile' });
  expect(await fail('GET /api/fs/hash', 'root=r&path=../x')).toMatchObject({ code: 'badPath' });
});

function tar(entries: { name: string; body?: string; link?: string }[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const e of entries) {
    const data = enc.encode(e.body ?? '');
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(enc.encode(s), at);
    put(e.name, 0);
    put('0000644\0', 100);
    put('0000000\0', 108);
    put('0000000\0', 116);
    put(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    put('14000000000\0', 136);
    put('        ', 148);
    put(e.link ? '2' : '0', 156);
    if (e.link) put(e.link, 157);
    put('ustar\u000000', 257);
    put(`${h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

test('extract unpacks a zip into a new folder and refuses an existing target', async () => {
  const { call, fail, root } = await setup();
  expect(await call('POST /api/fs/compress', { root: 'r', paths: ['a', 'top.txt'], name: 'pack.zip', format: 'zip' })).toEqual({ path: 'pack.zip', skippedLinks: [] });
  expect(await call('POST /api/fs/extract', { root: 'r', path: 'pack.zip', to: 'out' })).toEqual({ path: 'out' });
  expect(await readFile(join(root, 'out', 'a', 'b.txt'), 'utf8')).toBe('hello\nsecond line');
  expect(await readFile(join(root, 'out', 'top.txt'), 'utf8')).toBe('top');
  expect(await fail('POST /api/fs/extract', { root: 'r', path: 'pack.zip', to: 'a' })).toMatchObject({ code: 'exists' });
});

test('extract unpacks the tar inside a tar.gz', async () => {
  const { call, root } = await setup();
  await writeFile(join(root, 'x.tar.gz'), Bun.gzipSync(tar([{ name: 'd/one.txt', body: 'one' }, { name: 'two.txt', body: 'two' }])));
  await call('POST /api/fs/extract', { root: 'r', path: 'x.tar.gz', to: 'x' });
  expect(await readFile(join(root, 'x', 'd', 'one.txt'), 'utf8')).toBe('one');
  expect(await readFile(join(root, 'x', 'two.txt'), 'utf8')).toBe('two');
});

test('extract refuses a dot-dot entry and removes the target', async () => {
  const { fail, root } = await setup();
  await writeFile(join(root, 'slip.tar'), tar([{ name: 'ok.txt', body: 'ok' }, { name: '../evil.txt', body: 'evil' }]));
  expect(await fail('POST /api/fs/extract', { root: 'r', path: 'slip.tar', to: 't' })).toMatchObject({ code: 'archiveUnsafe' });
  expect(await stat(join(root, 'evil.txt')).catch(() => null)).toBeNull();
  expect(await stat(join(root, 't')).catch(() => null)).toBeNull();
});

test('extract refuses a link leading out of the target and removes it', async () => {
  const { fail, root } = await setup();
  await writeFile(join(root, 'slip.tar'), tar([{ name: 'out', link: '../../outside' }]));
  expect(await fail('POST /api/fs/extract', { root: 'r', path: 'slip.tar', to: 't' })).toMatchObject({ code: 'archiveUnsafe' });
  expect(await stat(join(root, 't')).catch(() => null)).toBeNull();
});

test('compress writes a 7z that extracts to the same files', async () => {
  const { call, fail, root } = await setup();
  expect(await call('POST /api/fs/compress', { root: 'r', paths: ['a/b.txt'], name: 'b.7z', format: '7z' })).toEqual({ path: 'a/b.7z', skippedLinks: [] });
  expect(await fail('POST /api/fs/compress', { root: 'r', paths: ['a/b.txt'], name: 'b.7z', format: '7z' })).toMatchObject({ code: 'exists' });
  expect(await fail('POST /api/fs/compress', { root: 'r', paths: ['a/b.txt', 'top.txt'], name: 'c.zip', format: 'zip' })).toMatchObject({ code: 'mixedParents' });
  await call('POST /api/fs/extract', { root: 'r', path: 'a/b.7z', to: 'a/b' });
  expect(await readFile(join(root, 'a', 'b', 'b.txt'), 'utf8')).toBe('hello\nsecond line');
});

test('extract and compress are refused on a read-only root', async () => {
  const { fail } = await setup();
  expect(await fail('POST /api/fs/compress', { root: 'ro', paths: ['top.txt'], name: 't.zip', format: 'zip' })).toMatchObject({ code: 'rootReadOnly' });
  expect(await fail('POST /api/fs/extract', { root: 'ro', path: 'top.txt', to: 'x' })).toMatchObject({ code: 'rootReadOnly' });
});
