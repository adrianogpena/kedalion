// Shared by the server and the web UI; keep this file free of runtime imports.

/** Header the web UI sends with the session token. */
export const TOKEN_HEADER = 'x-kedalion-token';

/** URL parameter with a one-time launch code; the UI trades it for the session token at SESSION_PATH. */
export const CODE_PARAM = 'c';

/** POST `{ code }` → `{ token }`; the only /api route that takes no token. */
export const SESSION_PATH = '/api/session';

/** Fixed port of `--dev` runs; Vite (port 5173) proxies /api to this port. */
export const DEV_PORT = 7420;
export const VITE_PORT = 5173;

/** JSON body of every failed API call. */
export interface ApiErrorBody {
  kind: string;
  /** Message id for translation (`error.<code>`); "raw" means `message` is shown as-is. */
  code?: string;
  /** English fallback. */
  message: string;
  params?: Record<string, string | number>;
  /** Raw tool output; never translated. */
  detail?: string;
}

/** Identity of an app; each app defines one in its `app.ts`. */
export interface AppIdentity {
  /** Display name: window title, sidebar, terminal output, release file names. */
  name: string;
  /** Lowercase id: data folder (~/.<id>), executable name in help text. */
  id: string;
  /** GitHub `owner/name` that hosts the releases (Settings > Updates links to them); unset while the app has no remote. */
  repo?: string;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Response bodies above this are cut and marked `truncated`. */
export const HTTP_MAX_BODY_BYTES = 10_000_000;
/** Request limits, shared by the send route, saved drafts and the editor. */
export const HTTP_MAX_HEADERS = 100;
export const HTTP_MAX_BODY_CHARS = 900_000;
/** Most form fields in a form or multipart body; their names and values share HTTP_MAX_BODY_CHARS. */
export const HTTP_MAX_FORM_FIELDS = 100;
export const HTTP_MAX_URL_CHARS = 4096;
export const HTTP_TIMEOUT_MIN_MS = 1_000;
export const HTTP_TIMEOUT_MAX_MS = 300_000;

export interface HttpRequestSpec {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  /** Set with `form` instead of `body`: the server encodes the fields (urlencoded or multipart text fields). */
  bodyKind?: 'form' | 'multipart';
  form?: Array<[string, string]>;
  /** Default 60_000, HTTP_TIMEOUT_MIN_MS..HTTP_TIMEOUT_MAX_MS. */
  timeoutMs?: number;
  /** Default false: skip TLS certificate checks. */
  insecure?: boolean;
  /** Default true. */
  followRedirects?: boolean;
}

export interface HttpHeaderDraft {
  name: string;
  value: string;
  enabled: boolean;
}

export interface HttpFormField {
  name: string;
  value: string;
}

export type HttpAuthKind = 'basic' | 'bearer';

/** A request as the editor holds and saves it; `draftToSpec` (editor) turns it into a spec. */
export interface HttpRequestDraft {
  method: HttpMethod;
  url: string;
  headers: HttpHeaderDraft[];
  body: string;
  bodyLang: 'json' | 'xml' | 'text' | 'form' | 'multipart';
  /** The fields when `bodyLang` is form or multipart. */
  form?: HttpFormField[];
  /** Mode hint for the saved secret; the secret itself is only in the saved record's `auth`. */
  authKind?: HttpAuthKind;
  timeoutMs?: number;
  insecure?: boolean;
  followRedirects?: boolean;
}

/** Body of `POST /api/http/send`; `{{name}}` in the request is resolved on the server from `environment` and the built-ins. */
export interface HttpSendInput {
  request: HttpRequestSpec;
  /** Saved request id whose secret Authorization is added (same origin as the resolved URL only). */
  secretRef?: string;
  /** Environment id; omitted = built-ins only. */
  environment?: string;
  /** The editor's unresolved draft, kept in the request history as is (Authorization dropped); without it the history keeps `request`. */
  draft?: HttpRequestDraft;
  /** Captured chain values, layered over the environment variables (these win). */
  vars?: Record<string, string>;
}

/** A value a chain step takes from its response: a JSON path (`$.a.b[0]`) of the body, or a header name. */
export interface RestChainCapture {
  name: string;
  from: 'body' | 'header';
  path: string;
}

export interface RestChainStep {
  /** Saved request id. */
  requestId: string;
  captures: RestChainCapture[];
}

/** `GET /api/rest/chains` items. */
export interface RestChain {
  id: string;
  name: string;
  steps: RestChainStep[];
  createdAt?: string;
  updatedAt?: string;
}

/** A sent REST request in the history (`GET /api/rest/history?q=`, newest first). */
export interface RestHistoryEntry {
  id: string;
  /** Send time, ms since epoch. */
  at: number;
  method: HttpMethod;
  /** As typed, `{{name}}` unresolved. */
  url: string;
  /** HTTP status; 0 when no response came (see `error`). */
  status: number;
  ms: number;
  /** Unresolved, without Authorization headers. */
  draft: HttpRequestDraft;
  /** Error code when the request failed before a response (`unknownVariable`, `badUrl`, a network error…). */
  error?: string;
}

export const REST_ENV_MAX_VARS = 200;
export const REST_ENV_NAME_CHARS = 80;
/** A variable name as `{{name}}` refers to it. */
export const REST_VAR_NAME = /^[A-Za-z_][\w.-]{0,99}$/;
/** Names `{{$name}}` resolves without an environment. */
export const REST_BUILTIN_VARIABLES = ['$timestamp', '$isoTimestamp', '$uuid', '$randomInt'] as const;
/** A `{{name}}` reference (global; group 1 is the name); spaces inside the braces are allowed. */
export const REST_VAR_REFERENCE = /\{\{\s*(\$?[A-Za-z_][\w.-]*)\s*\}\}/g;

/** One `{{name}}` in a text: the name and the offsets of the whole reference. */
export interface RestVarRef {
  name: string;
  from: number;
  to: number;
}

/** Every `{{name}}` reference in `text`, in order. */
export function restVarRefs(text: string): RestVarRef[] {
  return [...text.matchAll(REST_VAR_REFERENCE)].map((m) => ({ name: m[1]!, from: m.index, to: m.index + m[0].length }));
}

/** A variable as the server returns it: a secret one has `value: ''` and `set` when a value is stored. */
export interface RestEnvVar {
  name: string;
  value: string;
  secret: boolean;
  enabled: boolean;
  set?: boolean;
}

/** A variable as the client saves it. Secret: a string `value` sets or replaces it (`''` clears); no `value` keeps the stored one (of `from`, the old name, when renamed). */
export interface RestEnvVarInput {
  name: string;
  value?: string;
  secret: boolean;
  enabled: boolean;
  from?: string;
}

/** `GET /api/rest/environments` items. */
export interface RestEnvironment {
  id: string;
  name: string;
  vars: RestEnvVar[];
  createdAt: string;
  updatedAt: string;
}

/** Body of `POST /api/rest/environments` and `PUT /api/rest/environments?id=`. */
export interface RestEnvironmentInput {
  name: string;
  vars: RestEnvVarInput[];
}

export interface HttpResponseInfo {
  /** Key for POST /api/http/save. */
  id: string;
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  headers: Array<[string, string]>;
  /** Until the headers arrived. */
  ms: number;
  /** Until the body was read. */
  totalMs: number;
  /** Body bytes read. */
  size: number;
  truncated: boolean;
  /** The Content-Type header, '' when absent. */
  contentType: string;
  /** The name the save dialog suggests for the body. */
  fileName: string;
  /** Set for text-like bodies (UTF-8). */
  text?: string;
  /** Set otherwise; the bytes are only reachable through save. */
  binary?: true;
}

/** True when an app id can serve as a URL scheme (`<id>://open/<path>`). */
export const isUrlScheme = (id: string): boolean => /^[a-z][a-z0-9+.-]*$/.test(id);

/** True for a plain object (not null, not an array). */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One `GET /api/fs/tail` answer: the whole lines in bytes `[from, to)` of a file `size` bytes long. */
export interface TailChunk {
  from: number;
  to: number;
  size: number;
  mtime: number;
  text: string;
  /** The unterminated last line being written; `to` stops before it. */
  partial?: string;
  /** The file is shorter than the requested `from` (truncated or rotated). */
  reset?: true;
}

/** `GET /api/fs/info`: one entry's properties; a link is described itself, not its target. Times are epoch ms. */
export interface FsInfo {
  name: string;
  /** Absolute path on disk. */
  fullPath: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
  /** Null when the file system doesn't record it. */
  created: number | null;
  modified: number;
  accessed: number;
  readOnly: boolean;
}

/** One `GET /api/fs/du` line: running totals; the last one has `done`. */
export interface FsDuProgress {
  files: number;
  dirs: number;
  bytes: number;
  done?: true;
}

/** `GET /api/fs/hash`. */
export interface FsHash {
  sha256: string;
}

/** `POST /api/fs/extract`: unpacks the archive `path` into the new folder `to` (must not exist). */
/**
 * `POST /api/fs/save-new` body (an untitled tab): `target` (absolute) is a path the in-app save dialog
 * returned; `path` (absolute) is a path an earlier save of this server returned, else `notASaveTarget`. Reply `{ path }`.
 */
export interface FsSaveNewRequest {
  text: string;
  target?: string;
  path?: string;
}

export interface FsExtractRequest {
  root: string;
  path: string;
  to: string;
}

/** `POST /api/fs/extract` reply: `path` is the created folder, relative to the root. */
export interface FsExtractResult {
  path: string;
}

export type FsArchiveFormat = 'zip' | '7z';

/** `POST /api/fs/compress`: archives `paths` (all in one folder) into the file `name` in that folder (must not exist). */
export interface FsCompressRequest {
  root: string;
  paths: string[];
  name: string;
  format: FsArchiveFormat;
}

/** `POST /api/fs/compress` reply: `path` is the archive, relative to the root; links that could not be stored are listed (root-relative). */
export interface FsCompressResult {
  path: string;
  skippedLinks: string[];
}

export type EditorId = 'vscode' | 'intellij';

/** One entry of `GET /api/editors`. */
export interface EditorInfo {
  id: EditorId;
  name: string;
  /** The program that opens it: the override, else the detected one; null when not found. */
  path: string | null;
  custom: boolean;
}

/** What a record import did, per store. */
export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ id?: string; code: string; message: string }>;
}

/** `POST /api/backup/inspect`; token null = the file dialog was cancelled. */
export type BackupInspect =
  | { token: null }
  | { token: string; appVersion: string; exportedAt: string; settings: boolean; stores: Array<{ name: string; count: number; known: boolean }> };

/** One side of a file's git state: the porcelain v2 status letter, `.` unchanged, `?` untracked. */
export type GitCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

/** A changed file, root-relative; one both staged and modified appears twice, once per group. */
export interface GitFile {
  path: string;
  origPath?: string;
  index: GitCode;
  worktree: GitCode;
  group: 'staged' | 'unstaged' | 'untracked' | 'conflict';
  /** Added and removed line counts; undefined for binary or oversized files and when git could not count. */
  added?: number;
  removed?: number;
}

/** `GET /api/git/status`. */
export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  /** With `ignored=1`: the ignored files and folders (a folder ends in `/` and its contents are not listed). */
  ignored?: string[];
}

/** One entry of `GET /api/git/repos`. */
export interface GitRepoInfo {
  root: string;
  repo: boolean;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  error?: string;
}

/** `GET /api/git/file`: a file at HEAD, in the index, at a commit or at its first parent. */
export interface GitFileContent {
  text?: string;
  binary?: boolean;
  tooLarge?: boolean;
  missing?: boolean;
}

/** One entry of `GET /api/git/log`, newest first. */
export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  /** Branch and tag names pointing at it, as `git log --format=%D` prints them. */
  refs?: string;
}

/** A file changed by a commit (`GET /api/git/commit`), compared with its first parent; root-relative. */
export interface GitCommitFile {
  path: string;
  origPath?: string;
  status: GitCode;
}

/** `GET /api/git/diff`. */
export interface GitDiff {
  text: string;
  truncated: boolean;
}

/** One statement of the SQL history (`GET /api/db/history`), newest first. */
export interface SqlHistoryEntry {
  id: string;
  /** The database connection record id. */
  connectionId: string;
  sql: string;
  /** Start time, ms since epoch. */
  at: number;
  /** Duration of the execute call (a query's rows stream later). */
  ms: number;
  /** Rows affected, or rows a query streamed once its rows were read. */
  rows?: number;
  error?: string;
}
