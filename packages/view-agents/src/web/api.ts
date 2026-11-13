import { request, stream } from '@kedalion/ui';
import { listSessions, openSession, type Ticketed } from '@kedalion/terminal/session';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import { hydrateUiState, setUiStatePersister } from './ui-state';
import type { AgentDeleteResult, AgentCompareResponse, AgentFileStatusResponse, AgentSiblingSession, AgentRestoreResult, AgentTrashEntry, AgentTrashError, AgentLaunch, AgentLifecycleError, AgentStopResult, AgentAccount,AgentAccountUsage, AgentProject, AgentRateLimit, AgentRunning, AgentSearchHit, AgentSessionView, AgentsCapWarn, AgentStatus, AgentStatuslineError, AgentStatuslineStatus, AgentSkillsResponse, AgentTagCount, AgentTraceResponse, AgentTree, AgentTreePatch } from '../protocol.ts';

export type { AgentAccount, AgentAccountUsage, AgentProject, AgentRateLimit, AgentRunning, AgentSearchHit, AgentSessionView, AgentsCapWarn, AgentStatus, AgentStatuslineError, AgentStatuslineStatus, AgentTagCount, AgentTree, AgentTreePatch };

let rightSideMap: Promise<unknown> | undefined;

/** The saved right sidebar map (`{ [scope]: { list, open? } }`), fetched once per page load; `{}` when the request fails. */
export function loadRightSideMap(): Promise<unknown> {
  rightSideMap ??= request<unknown>('GET', '/api/agents/right-side').catch(() => ({}));
  return rightSideMap;
}

/** Saves one scope on the server (best effort) and keeps the cached map current. */
export function saveRightSide(scope: string, value: { list: string[]; open?: boolean; folded?: string[] }): void {
  rightSideMap = loadRightSideMap().then((m) => ({ ...(m && typeof m === 'object' ? m : {}), [scope]: value }));
  void request('PUT', '/api/agents/right-side', {}, { scope, value }).catch(() => undefined);
}

setUiStatePersister((key, value) => {
  void request('PUT', '/api/agents/ui-state', {}, { key, value }).catch(() => undefined);
});

/** Fetches the saved UI state once and applies it to the in-memory state (`{}` when the request fails); true on the first apply. */
export async function loadUiState(): Promise<boolean> {
  const map = await request<unknown>('GET', '/api/agents/ui-state').catch(() => ({}));
  return hydrateUiState(map);
}

export const listAccounts =() => request<AgentAccount[]>('GET', '/api/agents/accounts');
/** Sets the account new sessions launch as (`dir` "" = the default); the server saves it and rebuilds the tree. */
export const setActiveAccount = (dir: string) => request<import('../protocol.ts').AgentActiveAccountResult>('POST', '/api/agents/accounts/active', {}, { dir });
/** Creates `~/.claude-<name>` with links to the checked default-account entries; listed right away. */
export const addAccount = (name: string, share: AgentShareEntry[]) => request<import('../protocol.ts').AgentAccountAddResult>('POST', '/api/agents/accounts/add', {}, { name, share });
/** The entries of an account folder that are links now. */
export const readSharedEntries = (folder: string) => request<import('../protocol.ts').AgentAccountSharedResult>('POST', '/api/agents/accounts/shared', {}, { folder });
export const applySharedEntries = (folder: string, share: AgentShareEntry[]) => request<import('../protocol.ts').AgentAccountApplyResult>('POST', '/api/agents/accounts/shared/apply', {}, { folder, share });
/** Deletes `~/.claude-<name>` (links first); clears the active choice when it was active. */
export const deleteAccount = (folder: string) => request<import('../protocol.ts').AgentAccountDeleteResult>('POST', '/api/agents/accounts/delete', {}, { folder });
/** Prefs of every account (usage overrides, status icons); only overrides are stored. */
export const getAccountPrefs = () => request<import('../protocol.ts').AccountPrefsMap>('GET', '/api/agents/accounts/prefs');
/** Replaces the whole prefs map; the server validates it and tells open views. */
export const putAccountPrefs = (prefs: import('../protocol.ts').AccountPrefsMap) => request<import('../protocol.ts').AccountPrefsSetResult>('PUT', '/api/agents/accounts/prefs', {}, { prefs });
type AgentShareEntry = import('../protocol.ts').AgentShareEntry;

/** Thrown by `startSession` when `confirmCap` declined the soft-cap warning. */
export class CapDeclined extends Error {}

/** The message of a refused start / restart / stop. */
export function lifecycleMessage(r: { error?: AgentLifecycleError; cwd?: string }): string {
  if (r.error === 'cwdMissing') return t('agents.cwdMissing', { cwd: r.cwd ?? '' });
  if (r.error === 'external') return t('agents.openElsewhere');
  return t('agents.startFailed');
}

const launchOf = async (
  p: AgentLaunch,
  opts: { dir: string; cols?: number; rows?: number; confirmCap?: (w: AgentsCapWarn) => Promise<boolean> },
): Promise<Ticketed & { sessionId: string }> => {
  if (!p.ok) throw new Error(lifecycleMessage(p));
  if (p.warn && opts.confirmCap && !(await opts.confirmCap(p.warn))) throw new CapDeclined();
  const ticket = await openSession({ cols: opts.cols ?? 120, rows: opts.rows ?? 30, launch: p.launch, dir: opts.dir });
  return { ...ticket, sessionId: p.sessionId };
};

/** Starts `claude` in a terminal (new session, or resumes `sessionId`) and returns its Claude session id and terminal ticket. The folder is checked first. */
export async function startSession(opts: { account: string; dir: string; sessionId?: string; cols?: number; rows?: number; confirmCap?: (w: AgentsCapWarn) => Promise<boolean> }): Promise<Ticketed & { sessionId: string }> {
  return launchOf(await request<AgentLaunch>('POST', '/api/agents/terminal/prepare', {}, { account: opts.account, sessionId: opts.sessionId, dir: opts.dir }), opts);
}

/** Starts (resumes) a session without attaching a pane: the terminal keeps running and is found by `terminalOf` later. */
export const startInBackground = startSession;

/** Stops a session: done/error acknowledged, agent killed; `removed` when nothing was sent so it no longer exists. */
export async function stopSession(sessionId: string): Promise<{ removed: boolean }> {
  const r = await request<AgentStopResult>('POST', '/api/agents/session/stop', {}, { sessionId });
  if (!r.ok) throw new Error(lifecycleMessage(r));
  return { removed: r.removed === true };
}

/** Restarts a session: the old process ends and a new run starts (fresh conversation when there is no transcript to resume). */
export async function restartSession(sessionId: string, opts: { cols?: number; rows?: number } = {}): Promise<Ticketed & { sessionId: string }> {
  const p = await request<AgentLaunch>('POST', '/api/agents/session/restart', {}, { sessionId });
  return launchOf(p, { dir: p.ok ? (p.cwd ?? '') : '', ...opts });
}

/** The live terminal session id running Claude session `sessionId`, if any (from the pty `meta.agentSession`). */
export async function terminalOf(sessionId: string): Promise<string | undefined> {
  const all = await listSessions();
  return all.find((s) => !s.exited && s.meta?.agentSession === sessionId)?.id;
}


export const listAgentSessions = () => request<AgentSessionView[]>('GET', '/api/agents/sessions');

/** The trace (steps) of a session. */
export const getTrace = (sessionId: string) => request<AgentTraceResponse>('GET', '/api/agents/trace', { sessionId });
/** The steps of one subagent of a session (`runId` for an agent of a workflow run). */
export const getAgentTrace = (sessionId: string, agentId: string, runId?: string) => request<AgentTraceResponse>('GET', '/api/agents/trace/agent', { sessionId, agentId, ...(runId ? { runId } : {}) });
/** Git standing of the files a session touched. */
export const getFileStatus = (sessionId: string) => request<AgentFileStatusResponse>('GET', '/api/agents/trace/files', { sessionId });
/** Other sessions of the same project, newest first. */
export const getSiblings = (sessionId: string) => request<{ sessions: AgentSiblingSession[] }>('GET', '/api/agents/trace/siblings', { sessionId });
/** Headline numbers of a session next to another session (`with` = its id) or the project's average (`with` = `project`). */
export const getCompare = (sessionId: string, withId: string) => request<AgentCompareResponse>('GET', '/api/agents/trace/compare', { sessionId, with: withId });
/** Skills and agents of the active account; with `folder`, also the project's own. */
export const listSkills = (folder?: string) => request<AgentSkillsResponse>('GET', '/api/agents/skills', folder ? { folder } : undefined);
export const lastResponse =(sessionId: string) => request<{ text: string | null }>('GET', '/api/agents/last-response', { sessionId });
export const sessionHistory = (sessionId: string) => request<{ events: ChatEvent[] }>('GET', '/api/agents/history', { sessionId });

/** Mark unread: done / error become unseen again; a session with no status gets a fresh done. */
export const markUnread = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/unread', {}, { sessionId });
/** Ends the Claude process that runs the session in another terminal; true once it is gone. */
export const takeOverSession = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/session/takeover', {}, { sessionId });
/** Marks a session as seen (clears its `done` state). */
export const markSeen = (sessionId: string) => request<{ ok: boolean }>('POST', '/api/agents/seen', {}, { sessionId });
/** Runs the posts of one endpoint one after another, so a cleanup's null never lands after the next id. */
function inOrder<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const run = tail.then(() => fn(...args), () => fn(...args));
    tail = run.catch(() => undefined);
    return run;
  };
}
export const reportShown = inOrder((sessionId: string | null) => request<{ ok: boolean }>('POST', '/api/agents/shown', {}, { sessionId }));

export type TailEvent = import('../chat-protocol.ts').ChatEvent;
const tailListeners = new Set<(sessionId: string, events: TailEvent[]) => void>();
/** Subscribes to `tail` frames of the agents socket; returns the unsubscribe. */
export function onTail(fn: (sessionId: string, events: TailEvent[]) => void): () => void {
  tailListeners.add(fn);
  return () => void tailListeners.delete(fn);
}
/** Tells the server which external session's transcript is previewed (null: none). */
export const reportPreview = inOrder((sessionId: string | null) => request<{ ok: boolean }>('POST', '/api/agents/preview', {}, { sessionId }));

/** Opens the live socket; `onFrame` gets `{type:'sessions'|'status'|'usage'}` frames, `onClose` runs when the socket closes or fails. Returns a close function. */
export async function openAgentsSocket(onFrame: (f: { type: string; [k: string]: any }) => void, onClose?: () => void): Promise<() => void> {
  const { ticket } = await request<{ ticket: string }>('POST', '/api/agents/socket-ticket');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/agents/socket?t=${encodeURIComponent(ticket)}`);
  if (onClose) ws.onclose = () => onClose();
  ws.onmessage = (e) => {
    try {
      const f = JSON.parse(String(e.data));
      if (f.type === 'tail') for (const l of tailListeners) l(f.sessionId, f.events);
      onFrame(f);
    } catch { /* ignore malformed frames */ }
  };
  return () => ws.close();
}

export type { AgentAlert } from '../server/alerts.ts';
export const listAlerts = () => request<import('../server/alerts.ts').AgentAlert[]>('GET', '/api/agents/alerts');
export const listAgentProjects = () => request<AgentProject[]>('GET', '/api/agents/projects');
export const addAgentProject = (input: { name?: string; path: string }) => request<{ ok: boolean; project?: AgentProject }>('POST', '/api/agents/projects', {}, input);
export const removeAgentProject = (id: string) => request<{ ok: boolean }>('DELETE', '/api/agents/projects', { id });
/** The projects of the Explorer (`/api/projects`), offered as quick adds. */
export const listExplorerProjects = () => request<Array<{ id: string; name: string; path: string }>>('GET', '/api/projects');
/** Explorer projects not added yet (hidden ones included: adding one back un-hides it). */
export const listProjectSuggestions = () => request<Array<{ name: string; path: string }>>('GET', '/api/agents/projects/suggestions');


/** Sessions the previous run left live and that are not live now. */
export const listRecovery = () => request<AgentRunning[]>('GET', '/api/agents/recovery');
export const dismissRecovery = () => request<{ ok: boolean }>('POST', '/api/agents/recovery/dismiss');
/** The soft-cap warning when live terminals + chats reached the cap. */
export const capWarning = async () => (await request<{ warn?: AgentsCapWarn }>('GET', '/api/agents/cap')).warn;

export type StatuslineResult = { ok: true; status: AgentStatuslineStatus } | { ok: false; error: AgentStatuslineError };

export const listStatusline = () => request<AgentStatuslineStatus[]>('GET', '/api/agents/statusline');

export const installStatusline = (account: string) => request<StatuslineResult>('POST', '/api/agents/statusline/install', {}, { account });

export const uninstallStatusline = (account: string) => request<StatuslineResult>('POST', '/api/agents/statusline/uninstall', {}, { account });

/** Pins (`pin: 'cycle'` steps none > top > bottom > none), renames (`name` '' or null clears) or archives a session; a sessions frame follows. */
export const patchSessionState = (id: string, state: { pin?: 'top' | 'bottom' | 'none' | null | 'cycle'; name?: string | null; archived?: boolean; tags?: string[] }) =>
  request<{ ok: boolean }>('PATCH', '/api/agents/session-state', {}, { id, ...state });

/** Distinct tags with the number of listed sessions carrying each. */
export const listTags = () => request<AgentTagCount[]>('GET', '/api/agents/tags');
/** Appends tags (input order) to each session id, keeping the existing ones; never replaces. */
export const addTags = (ids: string[], tags: string[]) => request<{ ok: boolean }>('POST', '/api/agents/tags/add', {}, { ids, tags });
/** Removes a tag from every session; `count` = sessions changed. */
export const removeTagEverywhere = (tag: string) => request<{ ok: boolean; count: number }>('POST', '/api/agents/tags/remove', {}, { tag });

/** The stored sidebar tree (folders, manual orders, collapse, sort, view). */
export const getTree = () => request<AgentTree>('GET', '/api/agents/tree');
export type TreePatchResult = { ok: boolean; error?: 'activeView' | 'noop' | 'invalid'; tree: AgentTree };
export const patchTree = (patch: AgentTreePatch) => request<TreePatchResult>('PATCH', '/api/agents/tree', {}, patch);

export const getNotes = (project: string) => request<{ text: string }>('GET', '/api/agents/notes', { project });

export const putNotes = (project: string, text: string) => request<{ ok: boolean }>('PUT', '/api/agents/notes', {}, { project, text });

/** Server full-text search over prompts and replies; `onHit` per session with its first matching snippet. */
export const searchSessions = (q: string, onHit: (hit: AgentSearchHit) => void, signal?: AbortSignal) =>
  stream('/api/agents/search', { q }, (item) => onHit(item as AgentSearchHit), signal);

const trashMessage = (e: AgentTrashError): string =>
  e === 'running' ? t('agents.delete.running') : e === 'nothing' ? t('agents.delete.nothing') : e === 'exists' ? t('agents.trash.exists') : e === 'empty' ? t('agents.trash.undoEmpty') : t('agents.trash.gone');

/** User-visible text of a delete / restore refusal code. */
export { trashMessage };

/** Moves sessions to the trash; per-id outcomes (`skipped[].error` is a code, see `trashMessage`). */
export const deleteSessions = (ids: string[]) => request<AgentDeleteResult>('POST', '/api/agents/session/delete', {}, { ids });

/** Deletes one session; throws an Error with the refusal text when it was skipped. */
export async function deleteSession(id: string): Promise<void> {
  const r = await deleteSessions([id]);
  const s = r.skipped[0];
  if (s) throw new Error(trashMessage(s.error));
}

export const listTrash = () => request<AgentTrashEntry[]>('GET', '/api/agents/trash');

export const restoreTrashed = (id: string) => request<AgentRestoreResult>('POST', '/api/agents/trash/restore', {}, { id });

/** Restores the most recently deleted session of this run; `{ok:false, error:'empty'}` when there is none. */
export const undoDelete = () => request<AgentRestoreResult>('POST', '/api/agents/trash/undo', {}, {});
