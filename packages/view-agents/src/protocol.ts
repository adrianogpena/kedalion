/** Agents wire types shared by the server and the web UI (no server imports). */

export interface AgentAccount {
  /** The config folder name (`.claude`, `.claude-work`). */
  id: string;
  /** The config directory. */
  dir: string;
  /** OAuth account email; absent when unknown. */
  email?: string;
  /** Its email, or its folder path if unknown. */
  label: string;
  isDefault: boolean;
  /** Set by `GET /api/agents/accounts`: this is the account new sessions launch as. */
  active?: boolean;
}

/** Body of `POST /api/agents/accounts/active`: `dir` is the config dir of a listed account (the default's is stored as ""). */
export interface AgentActiveAccountSet {
  dir: string;
}

/** Reply of `POST /api/agents/accounts/active`; `label` feeds "New sessions will launch as <label>". */
export type AgentActiveAccountResult = { ok: true; label: string; account: AgentAccount } | { ok: false; error: 'unknownAccount' };

/** Entries of the default account a new account can link to (Add account checklist, Edit shared entries). */
export const AGENT_SHARE_ENTRIES = ['skills', 'agents', 'commands', 'CLAUDE.md', 'settings.json', 'plugins', 'projects'] as const;
export type AgentShareEntry = (typeof AGENT_SHARE_ENTRIES)[number];
/** Checked by default in the Add account checklist. */
export const AGENT_SHARE_DEFAULT: readonly AgentShareEntry[] = ['skills', 'agents', 'commands', 'CLAUDE.md'];

/** Refusals of the account admin routes: not a plain folder name, already an account, the default account, gone, or a file system error. */
export type AgentAccountAdminError = 'invalidName' | 'exists' | 'default' | 'notFound' | 'failed';

/** Link counts of an add / apply: `skippedDevMode` = file links Windows refused (needs developer mode). */
export interface AgentShareReport {
  linked: number;
  unlinked: number;
  skipped: number;
  skippedDevMode: number;
}

/** Body of `POST /api/agents/accounts/add`. */
export interface AgentAccountAdd {
  name: string;
  share: AgentShareEntry[];
}
/** Reply of `POST /api/agents/accounts/add`: the new account is listed right away (without an email until `/login`). */
export type AgentAccountAddResult = ({ ok: true; folder: string; account: AgentAccount } & AgentShareReport) | { ok: false; error: AgentAccountAdminError };
/** Reply of `POST /api/agents/accounts/shared` `{folder}`: entries that are links now. */
export type AgentAccountSharedResult = { ok: true; shared: AgentShareEntry[] } | { ok: false; error: AgentAccountAdminError };
/** Reply of `POST /api/agents/accounts/shared/apply` `{folder, share}`. */
export type AgentAccountApplyResult = ({ ok: true; folder: string } & AgentShareReport) | { ok: false; error: AgentAccountAdminError };
/** Reply of `POST /api/agents/accounts/delete` `{folder}`; `wasActive` = the active choice was cleared. */
export type AgentAccountDeleteResult = { ok: true; folder: string; wasActive: boolean } | { ok: false; error: AgentAccountAdminError };

/** Statuses whose icon an account can change: running (working), waiting (needs you), idle, stopped (exited). */
export const ACCOUNT_STATUS_KEYS = ['running', 'waiting', 'idle', 'stopped'] as const;
export type AccountStatusKey = (typeof ACCOUNT_STATUS_KEYS)[number];

/** Curated icon ids per status; the first is the built-in default (what an account without an override shows). */
export const ACCOUNT_STATUS_ICONS: Record<AccountStatusKey, readonly string[]> = {
  running: ['dot', 'diamond', 'play', 'spinner', 'box', 'lozenge', 'bars'],
  waiting: ['dot', 'diamond', 'bang', 'triangle', 'box', 'lozenge'],
  idle: ['ring', 'pause', 'dash', 'lozenge', 'box', 'diamond', 'dot'],
  stopped: ['square', 'cross', 'check', 'dash', 'diamond', 'box', 'dot'],
};

/** Usage keys an account can override (same meaning as the global `usage.*` settings, without the prefix). */
export const ACCOUNT_USAGE_BOOL_KEYS = ['show', 'compact', 'use24HourClock', 'showAccount', 'showModel', 'showCache', 'showContext', 'showFiveHour', 'showSevenDay', 'showCost'] as const;
export type AccountUsageBoolKey = (typeof ACCOUNT_USAGE_BOOL_KEYS)[number];

/** Per-account usage overrides; an unset key inherits the global setting. */
export type AccountUsagePrefs = { [K in AccountUsageBoolKey]?: boolean } & { position?: 'top' | 'bottom' };

/** One account's overrides; only overrides are stored (unset = default / global). */
export interface AccountPrefs {
  usage?: AccountUsagePrefs;
  icons?: { [K in AccountStatusKey]?: string };
}
/** Prefs by account id (the config folder name, `.claude-work`). */
export type AccountPrefsMap = Record<string, AccountPrefs>;
/** Reply of `PUT /api/agents/accounts/prefs` `{prefs}` (the whole map): the stored map, or `invalid` (unknown account, key or icon id; nothing changed). */
export type AccountPrefsSetResult = { ok: true; prefs: AccountPrefsMap } | { ok: false; error: 'invalid' };

/** One project node of the sidebar: with `shareProjects` off a project has one per account, adjacent and sorted by `suffix`. */
export interface AgentProjectNode {
  /** Node key: the project id, or `<project id>\u0000<account id>` when split. Collapse state is per node; folders / order use `project`. */
  node: string;
  project: string;
  /** Owner account id of a split node. */
  account?: string;
  /** Account part of a split node's label: email, folder name or "default". */
  suffix?: string;
}

/** UI status: Running, Waiting (`needs-you`), Done (unseen), Idle, Starting, Error (shown on screen), Exited, Stopped. */
export type AgentStatus = 'running' | 'needs-you' | 'done' | 'idle' | 'starting' | 'error' | 'exited' | 'stopped';

/** Category of a status: Starting + Running = running; Done + Waiting = waiting; Exited + Error = error. */
export type AgentCategory = 'running' | 'waiting' | 'idle' | 'error' | 'stopped';

export const STATUS_CATEGORY: Record<AgentStatus, AgentCategory> = { starting: 'running', running: 'running', done: 'waiting', 'needs-you': 'waiting', idle: 'idle', exited: 'error', error: 'error', stopped: 'stopped' };

export type AgentPin = 'top' | 'bottom';

/** A tree folder: random 8-hex id, a label, and the project keys in it (stored order). */
export interface AgentTreeFolder {
  id: string;
  name: string;
  projects: string[];
}

export type AgentTreeSort = 'manual' | 'recent' | 'actionable';
export type AgentTreeView = 'normal' | 'active';

/** `<dataDir>/agents/tree.json`, all keyed by project key (`GET`/`PATCH /api/agents/tree`). */
export interface AgentTree {
  folders: AgentTreeFolder[];
  topOrder: string[];
  sessionOrder: Record<string, string[]>;
  /** Node keys: `folder:<id>` and `project:<project key>`. */
  collapsed: string[];
  sort: AgentTreeSort;
  view: AgentTreeView;
}

/** Body of `PATCH /api/agents/tree`; the reply is `{ ok, error?, tree }`. */
export type AgentTreePatch =
  | { collapse: { key: string; collapsed: boolean } }
  | { sort: AgentTreeSort }
  | { view: AgentTreeView }
  | { move: { kind: 'folder'; id: string; dir: -1 | 1 } }
  | { move: { kind: 'project'; key: string; dir: -1 | 1; folder?: string; displayed: string[] } }
  | { move: { kind: 'session'; project: string; id: string; dir: -1 | 1; displayed: string[] } }
  | { freeze: Record<string, string[]> }
  | { newSession: { project: string; id: string } }
  | { clearedId: { project: string; oldId: string; newId: string } }
  | { folderCreate: { name: string } }
  | { folderRename: { id: string; name: string } }
  | { folderDelete: { id: string } }
  /** `keys` are distinct project keys in order; `folder` absent = the top-level manual order. */
  | { moveToFolder: { keys: string[]; folder?: string } };

/** One row of `GET /api/agents/tags`: a distinct tag and the number of listed sessions carrying it. */
export interface AgentTagCount {
  tag: string;
  count: number;
}

export interface AgentSession {
  id: string;
  account: string;
  cwd: string;
  title: string;
  firstPrompt: string;
  updatedAt: number;
  gitBranch?: string;
  model?: string;
  /** Token sums over the transcript's assistant `message.usage` entries (each message counted once). */
  tokens?: AgentTokens;
  /** Context window used, 0-100: from the statusLine usage file, else the last assistant turn vs the model's window; absent when unknown. */
  contextPercent?: number;
  /** Context % at the first statusLine reading above 0 (what every request carries: system prompt, tools, CLAUDE.md). */
  startupContextPercent?: number;
  /** Model display name from the statusLine usage file. */
  modelName?: string;
  /** Effort level from the statusLine usage file (only when Claude sends it). */
  effort?: string;
  /** Claude Code version from the statusLine usage file. */
  claudeVersion?: string;
  /** Prompt-cache state from the transcript tail: time of the last request and the cache TTL. */
  cache?: AgentCacheState;
  /** Held at the top or bottom of its project. */
  pin?: AgentPin;
  /** Derived: `pin === 'top'`. */
  pinned?: boolean;
  /** App-side name overriding the title. */
  name?: string;
  /** Hidden under the collapsed Archived section. */
  archived?: boolean;
  /** Normalised tags (the field is absent when empty). */
  tags?: string[];
}

/** Stored pin / rename / archive state of one session (`PATCH /api/agents/session-state`). */
export interface AgentSessionState {
  pin?: AgentPin;
  name?: string;
  archived?: boolean;
  tags?: string[];
}

/** Notes of a project (`GET /api/agents/notes?project=`). */
export interface AgentNotes {
  text: string;
}

/** Body of `PUT /api/agents/notes`; the reply is `{ ok }`. */
export interface AgentNotesWrite {
  project: string;
  text: string;
}

/** One line of the streamed `GET /api/agents/search?q=` ndjson (first match per session). */
export interface AgentSearchHit {
  sessionId: string;
  snippet: string;
}

/** Prompt cache of a session: the newest reply's time (ms epoch) and the TTL its cache write used (1 h or 5 min). */
export interface AgentCacheState {
  lastRequestAt: number;
  ttlMs: number;
}

export interface AgentTokens {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** One plan rate-limit window: percent used and when it resets (ms epoch). */
export interface AgentRateLimit {
  percent: number;
  resetsAt?: number;
  /** When the record this reading came from was written (ms epoch); older than 15 min = stale. */
  updatedAt?: number;
}

/** Plan usage of an account: per window, the freshest statusLine usage record with a value (same-email or untagged). */
export interface AgentAccountUsage {
  account: string;
  label: string;
  updatedAt: number;
  /** Signed-in account email, when the statusLine script found it. */
  email?: string;
  /** The account new sessions launch as; the usage block shows this account's 5h/7d whatever session is selected. */
  active?: boolean;
  fiveHour?: AgentRateLimit;
  sevenDay?: AgentRateLimit;
  /** Estimated spend from transcript token counts × a static price table; absent when no priced message was seen. */
  cost?: AgentCost;
}

/** Estimated USD spent by an account, per local day (assistant message timestamps). */
export interface AgentCost {
  today: number;
  yesterday: number;
}

/** `GET /api/agents/usage/history`: per account email (or 'unknown'), the 7d quota percent spent per local day ('YYYY-MM-DD'). */
export type AgentSevenDayHistory = Record<string, Record<string, number>>;

/** A session as the UI gets it: its status and the project its cwd belongs to. */
export interface AgentSessionView extends AgentSession {
  status: AgentStatus;
  /** Id of the added project the cwd belongs to. */
  project?: string;
  /** Project node key (`AgentProjectNode.node`): equals `project`, or is split per owner account when `shareProjects` is off. */
  node?: string;
  /** Account part of a split node's label (email, folder name or "default"); only on split nodes. */
  nodeSuffix?: string;
  /** Set (with more than one account) when another account than the active one owns the session: dim the title. */
  foreign?: boolean;
  /** Email part before `@` (or folder name) of the owner; set with `foreign` when `showOwner` is on. */
  owner?: string;
  seenAt?: number;
  /** A process runs it now (pid record, starting or exited pty); false for an offline session showing Done / Exited from an unseen mark. */
  live?: boolean;
  /** Claude is running this session in another terminal (live pid file that is not ours). */
  external?: boolean;
  /** A pid file claims this session but no Claude process runs it (it crashed or its terminal was killed): needs closing. Set with `external`. */
  hanging?: boolean;
  /** `starting`: our terminal runs it but Claude's pid file has not appeared yet; `exited`: the process ended and its terminal is still listed. */
  lifecycle?: 'starting' | 'exited';
  /** Exit code when `lifecycle` is `exited` (null = no code). */
  exitCode?: number | null;
  /** Time (ms epoch) the current status began; the UI falls back to `updatedAt`. */
  statusSince?: number;
}

/** Why a session start / restart / stop was refused. */
export type AgentLifecycleError = 'cwdMissing' | 'external' | 'unknownSession' | 'unknownAccount';

/** Reply of `POST /api/agents/session/restart` and (with `dir`) `POST /api/agents/terminal/prepare`: the launcher args for `POST /api/terminal/open`. */
export type AgentLaunch =
  | { ok: true; sessionId: string; launch: { id: string; args: unknown }; cwd?: string; warn?: AgentsCapWarn }
  | { ok: false; error: AgentLifecycleError; cwd?: string };

/** Why a delete or restore was refused (`empty`: nothing to undo). */
export type AgentTrashError = 'running' | 'nothing' | 'gone' | 'exists' | 'empty';

/** Reply of `POST /api/agents/session/delete` (body `{id}` or `{ids}`): per-id outcomes. */
export interface AgentDeleteResult {
  deleted: string[];
  skipped: Array<{ id: string; error: AgentTrashError }>;
}

export interface AgentTrashEntry {
  id: string;
  agent: string;
  title: string;
  originalPath: string;
  trashedAt: number;
}

/** Reply of `POST /api/agents/trash/restore` and `/undo`: the restored session, or a refusal. */
export type AgentRestoreResult = { ok: true; id: string; title: string } | { ok: false; error: AgentTrashError };

/** Reply of `POST /api/agents/session/stop`: `removed` when nothing was sent, so the session no longer exists. */
export interface AgentStopResult {
  ok: boolean;
  removed?: boolean;
  error?: AgentLifecycleError;
}

/** Git state of a session cwd (`git status --porcelain=v2 --branch`); branch is null when detached. */
export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

/** Socket text frames: the full session list when it changes, else only the status map (session id -> status); `usage` when plan usage changes; `git` (cwd -> status) after each git poll. */
export type AgentsFrame =
  | { type: 'sessions'; sessions: AgentSessionView[] }
  | { type: 'status'; status: Record<string, AgentStatus> }
  | { type: 'usage'; accounts: AgentAccountUsage[] }
  | { type: 'git'; status: Record<string, GitStatus> }
  | { type: 'accountPrefs'; prefs: AccountPrefsMap }
  | { type: 'tail'; sessionId: string; events: import('./chat-protocol.ts').ChatEvent[] };

/** One step of a session trace (user prompt, assistant reply or tool call with its result). */
export interface AgentTraceStep {
  kind: 'user' | 'assistant' | 'tool' | 'thinking';
  label: string;
  detail: string;
  /** User step that the person did not type: an expanded skill, a subagent hand-back, a background-task notice or a system reminder. */
  source?: 'skill' | 'agent' | 'task' | 'system' | 'shell';
  error?: boolean;
  /** Time of the transcript entry, ms since epoch. */
  ts?: number;
  /** Tool: call to result. Assistant / thinking: the wait since the previous entry. */
  durationMs?: number;
  /** Tool name, e.g. `Bash`. */
  tool?: string;
  toolUseId?: string;
  /** Tool call with no result yet. */
  pending?: boolean;
  /** File a Read / Edit / Write touched. */
  file?: string;
  /** Edit / Write / MultiEdit changes of `file`. */
  edits?: AgentTraceEdit[];
  /** Bash command. */
  command?: string;
  /** Read: the `offset` / `limit` it asked for. */
  readRange?: { offset?: number; limit?: number };
  /** Grep / Glob: files its result listed. */
  hits?: string[];
  /** Bash: files the command writes, edits, deletes, moves or restores. */
  shellFiles?: AgentTraceShellFile[];
  /** Bash: exit code of a failed command. */
  exitCode?: number;
  /** WebFetch url or WebSearch query. */
  target?: string;
  /** TodoWrite: the list as written. */
  todos?: AgentTraceTodo[];
  /** Agent / Task call: what was launched and, once known, how it ended. */
  subagent?: AgentTraceSubagent;
  /** Task notification: the background agent it reports on. */
  notice?: AgentTraceNotice;
  /** Interruption, permission denial or session continuation. */
  marker?: 'interrupt' | 'denied' | 'continued';
  /** Token usage of the assistant message (on its first step only). */
  tokens?: AgentTraceTokens;
  /** Estimated USD of the request by token kind (on the same step as `tokens`; absent for an unknown model). */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Context tokens the request carried (input + cache read + cache write). */
  context?: number;
  /** `context` as a percent of the model's window (the statusLine window of the model, else 200k, 1M above that). */
  contextPercent?: number;
  model?: string;
  /** Id of the assistant message (one request) the step came from; parallel tool calls share it and only the first carries `tokens`. */
  messageId?: string;
  /** Length of the tool result text; about a quarter of it is the tokens it adds to the next request. */
  resultChars?: number;
  /** Written by a subagent. */
  sidechain?: boolean;
  /** Tool: what kind of work it is (files, shell, network, …), read from the tool and, for a shell, the command. */
  area?: AgentTraceArea;
  /** Assistant step whose model differs from the previous request's: the previous model. */
  modelFrom?: string;
}

/** What a tool call works on: the stations of the Activity map and the area filter of the Trajectory. */
export type AgentTraceArea = 'you' | 'model' | 'memory' | 'files' | 'shell' | 'web' | 'browser' | 'agents' | 'skills';
export const TRACE_AREAS: readonly AgentTraceArea[] = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills'];

/** `claude-opus-5-5` reads as `opus 5.5` (after lot-map, MIT). */
export function shortModel(model: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  return m === null ? model : `${m[1]} ${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}`;
}

export interface AgentTraceTodo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AgentTraceSubagent {
  type?: string;
  description?: string;
  model?: string;
  prompt?: string;
  background?: boolean;
  /** Final answer (foreground) or launch note, capped. */
  result?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** Claude Code's id of the agent: its transcript is `subagents/agent-<id>.jsonl` next to the session's. */
  agentId?: string;
  /** Workflow tool: the run, a group of agents. */
  workflow?: AgentTraceWorkflow;
}

export interface AgentTraceWorkflow {
  /** `meta.name` of the script, or the saved workflow's name. */
  name?: string;
  /** Folder of the run under `subagents/workflows/`. */
  runId?: string;
  /** Phase titles declared in `meta.phases`. */
  phases?: string[];
}

/** One subagent's own transcript, summed up: a launched agent or an agent of a workflow run. */
export interface AgentSubagentInfo {
  agentId: string;
  /** Workflow run the agent belongs to. */
  runId?: string;
  type?: string;
  description?: string;
  model?: string;
  phase?: string;
  /** From the workflow journal (a result record) or, for a launched agent, whether its last tool call has a result. */
  status: 'running' | 'done' | 'failed';
  startedAt?: number;
  endedAt?: number;
  /** Tokens of its last request (context plus output), as Claude Code reports an agent's total. */
  tokens?: number;
  /** Estimated USD of all its requests. */
  cost?: number;
  toolUses: number;
  errors: number;
  /** Label of the tool call it is waiting on. */
  current?: string;
  prompt?: string;
  /** Its last reply, or the result the workflow journal recorded. */
  result?: string;
}

export interface AgentTraceNotice {
  toolUseId: string;
  status?: string;
  summary?: string;
  /** Workflow notification: the value the script returned, capped. */
  result?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface AgentTraceShellFile {
  op: 'write' | 'edit' | 'delete' | 'move-from' | 'move-to' | 'restore';
  path: string;
}

export interface AgentTraceEdit {
  old: string;
  new: string;
}

export interface AgentTraceTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type AgentSkillState = 'on' | 'name-only' | 'user-invocable-only' | 'off';

/** Where a skill or agent file is and what its frontmatter says about running it. */
export interface AgentDetails {
  file: string;
  /** Last change of the file, ms since epoch (0 when unknown). */
  modified: number;
  /** Frontmatter keys worth showing: `argument-hint`, `allowed-tools`, `tools`, `model`. */
  fields: Record<string, string>;
}

export interface AgentSkill {
  name: string;
  description: string;
  state: AgentSkillState;
  /** `project` when it comes from the project's own `.claude`; absent for the account's. */
  source?: 'project';
  details?: AgentDetails;
}

export interface AgentLocal {
  name: string;
  description: string;
  source?: 'project';
  details?: AgentDetails;
}

export interface AgentSkillsResponse {
  account: string;
  skills: AgentSkill[];
  agents: AgentLocal[];
}

export interface AgentTraceResponse {
  steps: AgentTraceStep[];
  /** Working directory of the session. */
  cwd?: string;
  /** The session's subagents (launched and workflow agents), read from their own transcripts. */
  subagents?: AgentSubagentInfo[];
}

/** Where a file the session touched stands in git now. */
export type AgentFileGit = 'modified' | 'untracked' | 'added' | 'deleted' | 'committed' | 'reverted' | 'clean' | 'ignored' | 'outside';

export interface AgentFileStatusResponse {
  /** File path as the trace has it -> status. Empty when the cwd is not in a git repository. */
  status: Record<string, AgentFileGit>;
  /** Files whose disk state differs from the session's last change: edited by something else afterwards, or gone. */
  disk: Record<string, 'changed' | 'missing'>;
}

/** Headline numbers of a session, for comparing two sessions. */
export interface AgentSessionSummary {
  id: string;
  cost: number;
  turns: number;
  prompts: number;
  toolCalls: number;
  errors: number;
  spanMs: number;
  outputTokens: number;
  peakContext: number;
  filesEdited: number;
}

export interface AgentCompareResponse {
  current: AgentSessionSummary;
  /** The other session, or the average of `count` sibling sessions. */
  other?: AgentSessionSummary;
  count: number;
}

export interface AgentSiblingSession {
  id: string;
  mtime: number;
  prompt?: string;
}

/** A project added to the Agents view. */
export interface AgentProject {
  id: string;
  name: string;
  path: string;
}

/** A session the previous run left live (`GET /api/agents/recovery`), with what the banner and resume need. */
export interface AgentRunning {
  id: string;
  account: string;
  project?: string;
  title: string;
  cwd: string;
  /** Set when `restoreSessions` is `always`: the client resumes without the banner. */
  auto?: boolean;
}

/** Sent with a session start when live sessions reached the soft cap. */
export interface AgentsCapWarn {
  live: number;
  cap: number;
}

/** What the statusLine script stores per session in `<dataDir>/agents/usage/<account>/<sessionId>.json` (keys the CLI did not send are absent). */
export interface AgentUsage {
  updatedAt: number;
  sessionId: string;
  model?: { id?: string; display_name?: string };
  effort?: string;
  /** Claude Code version the CLI reported. */
  version?: string;
  startupContextPercent?: number;
  email?: string;
  context_window?: { used_percentage?: number | null; context_window_size?: number; total_input_tokens?: number; total_output_tokens?: number; [k: string]: unknown };
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
}

/** Install state of the usage statusLine for one account (`GET /api/agents/statusline`). */
export interface AgentStatuslineStatus {
  account: string;
  label: string;
  /** The account's `settings.json` statusLine is the Kedalion one. */
  installed: boolean;
  /** Command of the statusLine that is chained (kept for uninstall); absent when there was none. */
  previous?: string;
  /** `settings.json` exists and parses; install is refused otherwise. */
  settingsOk: boolean;
}

export type AgentStatuslineError = 'unknownAccount' | 'invalidSettings' | 'sharedSettings' | 'writeFailed';
