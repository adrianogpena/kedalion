import { join } from 'node:path';
import { PlatformError } from './errors.ts';
import { appHome } from './home.ts';
import { readJsonFile, writeJsonAtomic } from './json-file.ts';

export interface SecretStore {
  /** False when the OS store can't be used (Linux without secret-tool, macOS without security). */
  available(): boolean;
  /** Throws PlatformError 'secretsUnavailable' when the store isn't available. */
  set(ref: string, value: string): Promise<void>;
  /** null when nothing is stored under `ref` (or the store isn't available). */
  get(ref: string): Promise<string | null>;
  remove(ref: string): Promise<void>;
}

const REF = /^[\w.:-]{1,200}$/;
const unavailable = (detail?: string) => new PlatformError('secretsUnavailable', 'The secret store is not available.', detail);

/**
 * Passwords and tokens an app keeps for the current OS user. Windows: DPAPI-encrypted blobs in
 * `<dir>/secrets.json`, decryptable only under this Windows account; the DPAPI entropy is the public app id,
 * so any process of the same Windows user can decrypt them. Linux: libsecret via `secret-tool`;
 * macOS: the login keychain via `security` (both best-effort, untested).
 */
export function secretStore(appId: string, dir = appHome(appId)): SecretStore {
  if (!/^[\w.-]+$/.test(appId)) throw new Error(`secretStore: invalid app id "${appId}"`);
  const store =
    process.platform === 'win32'
      ? dpapiStore(appId, dir)
      : process.platform === 'linux'
        ? secretToolStore(appId)
        : process.platform === 'darwin'
          ? keychainStore(appId)
          : null;
  const checked = (ref: string) => {
    if (!REF.test(ref)) throw new Error(`secretStore: invalid ref "${ref}"`);
    return ref;
  };
  return {
    available: () => store?.available() ?? false,
    async set(ref, value) {
      checked(ref);
      if (!store?.available()) throw unavailable();
      await store.set(ref, value);
    },
    async get(ref) {
      checked(ref);
      return store?.available() ? store.get(ref) : null;
    },
    async remove(ref) {
      checked(ref);
      if (store?.available()) await store.remove(ref);
    },
  };
}

// --- Windows: DPAPI --------------------------------------------------------------------------

interface SecretsFile {
  version: 1;
  items: Record<string, string>;
}

const isSecretsFile = (v: unknown) =>
  typeof v === 'object' &&
  v !== null &&
  (v as SecretsFile).version === 1 &&
  typeof (v as SecretsFile).items === 'object' &&
  (v as SecretsFile).items !== null &&
  Object.values((v as SecretsFile).items).every((s) => typeof s === 'string');

function dpapiStore(appId: string, dir: string): SecretStore {
  const file = join(dir, 'secrets.json');
  const entropy = Buffer.from(appId, 'utf8');
  let items: Map<string, string> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const locked = <R>(job: () => Promise<R>): Promise<R> => {
    const run = chain.then(job);
    chain = run.catch(() => {});
    return run;
  };

  async function load(): Promise<Map<string, string>> {
    if (!items) items = new Map(Object.entries(((await readJsonFile(file, isSecretsFile)) as SecretsFile | undefined)?.items ?? {}));
    return items;
  }

  async function commit(next: Map<string, string>): Promise<void> {
    await writeJsonAtomic(file, { version: 1, items: Object.fromEntries(next) } satisfies SecretsFile, { mode: 0o600 });
    items = next;
  }

  return {
    available: () => true,
    set: (ref, value) =>
      locked(async () => {
        const sealed = dpapi(true, Buffer.from(value, 'utf8'), entropy);
        if (!sealed) throw unavailable('CryptProtectData failed');
        await commit(new Map(await load()).set(ref, sealed.toString('base64')));
      }),
    get: (ref) =>
      locked(async () => {
        const stored = (await load()).get(ref);
        if (stored === undefined) return null;
        const plain = dpapi(false, Buffer.from(stored, 'base64'), entropy);
        if (!plain) throw new PlatformError('secretUnreadable', 'A stored secret could not be decrypted.', ref);
        return plain.toString('utf8');
      }),
    remove: (ref) =>
      locked(async () => {
        const all = await load();
        if (!all.has(ref)) return;
        const next = new Map(all);
        next.delete(ref);
        await commit(next);
      }),
  };
}

const CRYPTPROTECT_UI_FORBIDDEN = 0x1;
let dpapiLib: ReturnType<typeof openDpapi> | null = null;

function openDpapi() {
  const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
  // (pDataIn, szDataDescr | ppszDataDescr, pOptionalEntropy, pvReserved, pPromptStruct, dwFlags, pDataOut)
  const sig = { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 } as const;
  const crypt32 = dlopen('crypt32.dll', { CryptProtectData: sig, CryptUnprotectData: sig });
  const kernel32 = dlopen('kernel32.dll', { LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr } });
  return { ...crypt32.symbols, ...kernel32.symbols };
}

/** A DATA_BLOB (x64: u32 cbData, 4 bytes padding, ptr pbData) over `data`; keep `data` alive during the call. */
function blobOf(data: Uint8Array, size = data.length): Buffer {
  const { ptr } = require('bun:ffi') as typeof import('bun:ffi');
  const blob = Buffer.alloc(16);
  blob.writeUInt32LE(size, 0);
  blob.writeBigUInt64LE(BigInt(ptr(data)), 8);
  return blob;
}

/** CryptProtectData (`protect`) or CryptUnprotectData over `data`; null when the call fails. */
function dpapi(protect: boolean, data: Uint8Array, entropy: Uint8Array): Buffer | null {
  const { toArrayBuffer } = require('bun:ffi') as typeof import('bun:ffi');
  const lib = (dpapiLib ??= openDpapi());
  // ptr() rejects empty buffers; cbData stays 0 for them.
  const input = data.length ? data : new Uint8Array(1);
  const inBlob = blobOf(input, data.length);
  const entropyBlob = blobOf(entropy);
  const out = Buffer.alloc(16);
  const call = protect ? lib.CryptProtectData : lib.CryptUnprotectData;
  const ok = call(inBlob, null, entropyBlob, null, null, CRYPTPROTECT_UI_FORBIDDEN, out);
  void [input, entropy];
  if (!ok) return null;
  const size = out.readUInt32LE(0);
  const at = Number(out.readBigUInt64LE(8)) as import('bun:ffi').Pointer;
  try {
    const copy = Buffer.alloc(size);
    if (size) copy.set(new Uint8Array(toArrayBuffer(at, 0, size)));
    return copy;
  } finally {
    lib.LocalFree(at);
  }
}

// --- Linux and macOS (best-effort, untested) -------------------------------------------------

async function exec(argv: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdin: input === undefined ? 'ignore' : Buffer.from(input, 'utf8'), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

function secretToolStore(appId: string): SecretStore {
  const attrs = (ref: string) => ['app', appId, 'ref', ref];
  return {
    available: () => Bun.which('secret-tool') !== null,
    async set(ref, value) {
      const r = await exec(['secret-tool', 'store', `--label=${appId}`, ...attrs(ref)], value);
      if (r.code !== 0) throw unavailable(r.stderr.trim());
    },
    async get(ref) {
      const r = await exec(['secret-tool', 'lookup', ...attrs(ref)]);
      return r.code === 0 ? r.stdout : null;
    },
    async remove(ref) {
      await exec(['secret-tool', 'clear', ...attrs(ref)]);
    },
  };
}

// The value never goes on argv: `security -i` reads the command from stdin. It is stored as hex
// text (no quoting needed), so reading always hex-decodes.
function keychainStore(appId: string): SecretStore {
  return {
    available: () => Bun.which('security') !== null,
    async set(ref, value) {
      const hex = Buffer.from(value, 'utf8').toString('hex');
      const r = await exec(['security', '-i'], `add-generic-password -U -s "${appId}" -a "${ref}" -w ${hex || '""'}\n`);
      if (r.code !== 0) throw unavailable(r.stderr.trim());
    },
    async get(ref) {
      const r = await exec(['security', 'find-generic-password', '-s', appId, '-a', ref, '-w']);
      return r.code === 0 ? Buffer.from(r.stdout.trim(), 'hex').toString('utf8') : null;
    },
    async remove(ref) {
      await exec(['security', 'delete-generic-password', '-s', appId, '-a', ref]);
    },
  };
}
