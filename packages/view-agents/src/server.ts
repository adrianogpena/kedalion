import { t } from '@kedalion/ui/i18n';
import { type FSWatcher, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createNotifications, type Notifications, type Toast } from '@kedalion/platform';
import { editorRoutes, gitRoutes, pickedPaths, rootedFs } from '@kedalion/server-mods';
import { defineServerView, invalid, ndjson, socketTickets, validGroup, type SocketData, type SocketRoutes } from '@kedalion/server-core';
import type { ServerWebSocket } from 'bun';
import type { AgentAccountUsage, AgentLocal, AgentSkill, AgentActiveAccountResult, AgentActiveAccountSet, AgentLaunch, AgentRunning, AgentSessionView, AgentsCapWarn, AgentsFrame, AgentStopResult } from './protocol.ts';
import type { AgentsSettings, AgentsUsagePosition } from './settings-types.ts';
import { summaryLimitOf } from './settings.ts';
import { type AgentAccount, accountByDir, createAccountRegistry, detectAccounts, resolveActiveAccount } from './server/accounts.ts';
import { createAlerts } from './server/alerts.ts';
import { createLayoutStore } from './server/layouts.ts';
import { createRightSideStore } from './server/right-side.ts';
import { createUiStateStore } from './server/ui-state.ts';
import { type PanelCtx, panelRoutes } from './server/panels/index.ts';
import { createGitPoller } from './server/git-status.ts';
import { checkHookSettings, createHookApprovals, createHooks, type HookConfirm } from './server/hooks.ts';
import { createNotifier, createTransitions, NOTIFY_LABEL } from './server/notify.ts';
import { createLimitWatch } from './server/limit-alerts.ts';
import { CLAUDE_LAUNCHER_ID, claudeLauncher } from './server/launcher.ts';
import { claudeCommand } from './server/claude-command.ts';
import { findSessionFile, loadHistory, sessionFilesOf } from './server/chat/normalize.ts';
import { createTailer, type Tailer } from './server/tail.ts';
import { lastResponse } from './server/last-response.ts';
import { diskCheck, fileStatus } from './server/file-status.ts';
import { averageOf, siblingFiles, siblingList, summaryOf, summaryOfFile } from './server/trace-summary.ts';
import { readTraceFull } from './server/trace.ts';
import { recoverShellChanges } from './server/git-recover.ts';
import { subagentFile, subagentsOf } from './server/subagents.ts';
import { listScoped } from './server/skills.ts';
import { capPerProject, createSessionScanner, matchProject } from './server/discovery.ts';
import { createLifecycle, cwdProblem, planRestart, stopOutcome, type TermInfo } from './server/lifecycle.ts';
import { detectScreenError } from './server/screen-errors.ts';
import { createProjectsStore, projectKey, type ProjectsStore } from './server/projects.ts';
import { createAccountPrefsStore } from './server/account-prefs.ts';
import { createRunningStore, type RunningRecord, type RunningStore } from './server/running.ts';
import { createNotesStore } from './server/notes.ts';
import { createSessionStateStore, isUuid, tagCounts, type SessionStateStore } from './server/session-state.ts';
import { applyAccountView, createTreeStore } from './server/tree.ts';
import { searchSessions } from './server/search.ts';
import { createStatuslineInstaller } from './server/statusline-install.ts';
import { addAccount, applyShared, deleteAccount, readShared, shareList } from './server/account-admin.ts';
import { forgetPendingAccount, markPendingAccount } from './server/accounts.ts';
import type { AccountPrefsSetResult, AgentAccountAddResult, AgentAccountApplyResult, AgentAccountDeleteResult, AgentAccountSharedResult } from './protocol.ts';
import { type AgentStatus, createStatusTracker, externalIds, isPidAlive, readPidFiles, scanPidFiles } from './server/status.ts';
import type { AgentDeleteResult, AgentRestoreResult, AgentTreePatch, AgentTrashEntry } from './protocol.ts';
import { createTrashStore, isSafeId } from './server/trash.ts';
import { createUsageReader, pruneUsage, usageContextPercent } from './server/usage.ts';
import { createSevenDayHistory } from './server/usage-history.ts';
import { costDays, withCost } from './server/pricing.ts';
import type { AgentSevenDayHistory } from './protocol.ts';

/** The part of the server settings the Agents view owns; the app's `Settings` extends it. */
export interface AgentsServerSettings {
  /** Agents settings, checked by `validAgents`. */
  agents?: AgentsSettings;
}

/** A copy of `raw` when it is a well-formed Agents settings group, else null. */
const USAGE_POSITIONS: AgentsUsagePosition[] = ['top', 'bottom'];

const AGENTS_SPEC = { restoreSessions: ['ask', 'always', 'never'] as const, softCap: [1, 100], notifyNeedsYou: 'boolean', taskSkill: 'string', notifyDone: 'boolean', notifyError: 'boolean', doNotDisturb: 'boolean', autoSettle: 'boolean', gitStatus: 'boolean', rightSidebarOpen: 'boolean', rightSidebarPerProject: 'boolean', ctl: 'boolean', resumeOnSelect: 'boolean', 'accounts.activeAccount': 'string', 'accounts.showAllSessions': 'boolean', 'accounts.shareProjects': 'boolean', 'accounts.showOwner': 'boolean', 'usage.show': 'boolean', 'usage.position': USAGE_POSITIONS, 'usage.compact': 'boolean', 'usage.use24HourClock': 'boolean', 'usage.showAccount': 'boolean', 'usage.showModel': 'boolean', 'usage.showCache': 'boolean', 'usage.showContext': 'boolean', 'usage.showFiveHour': 'boolean', 'usage.showSevenDay': 'boolean', 'usage.showCost': 'boolean', 'usage.context.warnAt': [0, 100], 'usage.context.critAt': [0, 100], 'usage.fiveHour.warnAt': [0, 100], 'usage.fiveHour.critAt': [0, 100], 'usage.sevenDay.warnAt': [0, 100], 'usage.sevenDay.critAt': [0, 100],maxSessionsPerProject: [1, 10000], maxSessionsOnSummary: [0, 10000],trashRetentionDays: [1, 3650], claudeCommand: 'string', 'hooks.onRunning': 'string', 'hooks.onWaiting': 'string', 'hooks.onDone': 'string', 'hooks.onError': 'string' } as const;

/** Told on every valid Agents config edit (the running view's git poller). */
let agentsConfigListener: ((group: AgentsSettings) => void) | undefined;

/** Validates the group; a valid one is the saved one, so the cached `claude` resolution is refilled from it. */
export const validAgents = (raw: unknown): AgentsSettings | null => {
  const { claudeArgs, ...all } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // Keys no longer in the spec (e.g. the removed `mode`) are dropped, not a reason to reject the whole group.
  const rest = Object.fromEntries(Object.entries(all).filter(([k, v]) => Object.hasOwn(AGENTS_SPEC, k) && !(k === 'maxSessionsOnSummary' && v === null)));
  const args = claudeArgs === undefined ? undefined : Array.isArray(claudeArgs) && claudeArgs.length <= 50 && claudeArgs.every((a) => typeof a === 'string' && a.length <= 300) ? (claudeArgs as string[]) : null;
  const group = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && args !== null ? (validGroup(rest, AGENTS_SPEC) as AgentsSettings | null) : null;
  if (!group) return null;
  if (args) group.claudeArgs = args;
  claudeCommand.configure(group);
  agentsConfigListener?.(group);
  return group;
};

export const AGENTS_SOCKET_PATH = '/api/agents/socket';
/** Same icon as the web view's `nav.icon`. */
const AGENTS_ICON = 'home';
const RESCAN_MS = 10_000;
const LIFECYCLE_MS = 1_000;
const DEBOUNCE_MS = 300;
const USAGE_WATCHED_MS = 30_000;
const USAGE_POLL_MS = 3_000;
const RUNNING_SYNC_MS = 5_000;
const DEFAULT_SOFT_CAP = 12;

export type { AgentSessionView };

/** The part of the terminal sessions store the view drives: list ptys, relink one to another Claude session id, kill one. */
export interface AgentTerminals {
  list(): Array<{ id: string; cwd: string; meta?: Record<string, unknown>; exited: number | null | undefined }>;
  setMeta(id: string, meta: Record<string, unknown> | undefined): void;
  close(id: string): void;
}

export interface AgentsServerViewOptions {
  /** Terminal sessions store: enables Starting/Exited, `/clear` id adoption, stop and restart. */
  terminals?: AgentTerminals;
  /** Home holding the `.claude*` account dirs; defaults to the user's home. */
  home?: string;
  rescanMs?: number;
  /** Last screen lines of the live terminal sessions, by Claude session id (pty `meta.agentSession`); drives the error status. */
  terminalScreens?: () => Iterable<[string, string[]]>;
  /** App link for a path (`StartContext.link`), read when a toast is shown; set by the host once the app started. */
  link?: () => ((path: string) => string) | undefined;
  /** The app's shared notifier (`createNotifications`); without it the view makes its own. */
  notifications?: Notifications;
  /** Toast sink (tests) for the view's own notifier; defaults to the Windows toaster. */
  toast?: (toast: Toast) => void;
  /** Asks the user to allow a new hook command; defaults to the OS Yes/No dialog (tests inject it). */
  confirm?: HookConfirm;
  /** Statusline installer overrides (tests). */
  statusline?: { execPath?: string; platform?: NodeJS.Platform };
}

export type { AgentsFrame };

/** The `claude` terminal launcher for `terminalServerView({ launchers: launchers({ claude: agentsLauncher() }) })`; same `home` as the view. */
export function agentsLauncher(opts: Pick<AgentsServerViewOptions, 'home'> & { env?: Record<string, string | undefined>; cmd?: string; mcpConfig?: () => string | undefined } = {}) {
  const home = opts.home ?? homedir();
  return claudeLauncher({ accounts: () => detectAccounts(home), env: opts.env, cmd: opts.cmd, mcpConfig: opts.mcpConfig });
}

/** Server half of the Agents view: accounts, sessions with live status, and a socket pushing changes. */
export function agentsServerView(opts: AgentsServerViewOptions = {}) {
  const home = opts.home ?? homedir();
  const scanner = createSessionScanner();
  const tracker = createStatusTracker();
  const life = createLifecycle();
  const tickets = socketTickets<true>();
  const clients = new Set<ServerWebSocket<SocketData>>();
  let watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let lifeTimer: ReturnType<typeof setInterval> | undefined;
  let usageTimer: ReturnType<typeof setInterval> | undefined;
  let lastLife = '';
  let seenFile = '';
  let usageDir: string | undefined;
  const usageReader = createUsageReader(() => usageDir);
  let historyFile: string | undefined;
  const sevenDayHistory = createSevenDayHistory(() => historyFile);
  let seen: Record<string, number> | undefined;
  let projects: ProjectsStore | undefined;
  let sessionState: SessionStateStore | undefined;
  let last = { sessions: '', status: '', usage: '' };
  let running: RunningStore | undefined;
  let runningTimer: ReturnType<typeof setInterval> | undefined;
  let loadSettings: () => Promise<AgentsServerSettings> = async () => ({});
  let gitCwds: string[] = [];
  const git = createGitPoller({ cwds: () => gitCwds, onUpdate: (status) => broadcast({ type: 'git', status }) });
  agentsConfigListener = (group) => {
    git.setEnabled(group.gitStatus !== false);
    if (clients.size > 0) void git.pollNow();
  };
  /** Session the web reports as on screen (Agents view open and focused); no toast for it. */
  let shownId: string | undefined;
  const notifications = opts.notifications ?? createNotifications({ appName: 'Agents', link: () => opts.link?.(), sink: opts.toast });
  const agentsNotify = notifications.for('agents');
  const show = (x: { title: string; body: string; launch: string }) => void agentsNotify(x);
  let approvalsFile: string | undefined;
  const approvals = createHookApprovals(() => approvalsFile);
  const hooks = createHooks({ settings: async () => (await loadSettings()).agents, flash: (title, body) => show({ title, body, launch: '' }), approvals }, createTransitions());
  let alertsDir: string | undefined;
  const alerts = createAlerts(() => alertsDir, createTransitions());
  const notifier = createNotifier({
    show,
    link: () => opts.link?.(),
    settings: async () => (await loadSettings()).agents,
    shown: () => shownId,
    text: (status, s) => {
      const name = projects?.list().find((p) => p.id === s.project)?.name || s.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s.cwd;
      return { title: `${NOTIFY_LABEL[status]}: ${name}`, body: s.title || s.firstPrompt || s.id };
    },
  });

  const limitWatch = createLimitWatch();
  /** Toasts a 5h or 7d window that turned red (the usage bars' critical percent), with its reset time. */
  const notifyLimits = async (accounts: AgentAccountUsage[]): Promise<void> => {
    const cfg = (await loadSettings().catch(() => undefined))?.agents;
    const crit = (key: 'usage.fiveHour.critAt' | 'usage.sevenDay.critAt', fallback: number) => (typeof cfg?.[key] === 'number' && Number.isFinite(cfg[key]) ? cfg[key] : fallback);
    const toasts = limitWatch.observe(accounts, { fiveHour: crit('usage.fiveHour.critAt', 80), sevenDay: crit('usage.sevenDay.critAt', 90) });
    if (cfg?.doNotDisturb === true) return;
    for (const t of toasts) show({ ...t, launch: '' });
  };

  const liveTerminalIds = () => [...(opts.terminalScreens?.() ?? [])].map(([id]) => id);

  /** The Claude ptys of the terminal store (live and exited). */
  const claudeTerms = (): TermInfo[] =>
    (opts.terminals?.list() ?? []).flatMap((s) =>
      typeof s.meta?.agentSession === 'string' ? [{ id: s.id, sessionId: s.meta.agentSession, account: typeof s.meta.account === 'string' ? s.meta.account : undefined, cwd: s.cwd, exited: s.exited }] : [],
    );

  /** One lifecycle step: finds the Starting / Exited sessions and applies `/clear` id changes to the ptys' meta. */
  const lifecycleStep = (pids: ReturnType<typeof readPidFiles>) => {
    const r = life.poll(claudeTerms(), pids);
    for (const a of r.adopt) {
      const cur = opts.terminals?.list().find((x) => x.id === a.terminal);
      if (cur) opts.terminals?.setMeta(a.terminal, { ...cur.meta, agentSession: a.to });
      tracker.settle(a.from);
    }
    return r;
  };

  const hasTranscript = (id: string) => accounts().some((a) => findSessionFile(a.dir, id) !== undefined);

  /** The one tailer, for the previewed external session; same path again is a no-op. */
  let tail: { sessionId: string; path: string; tailer: Tailer } | undefined;
  let previewSeq = 0;
  const stopTail = () => {
    tail?.tailer.stop();
    tail = undefined;
  };
  const syncTail = async (sessionId: string | undefined) => {
    const seq = ++previewSeq;
    let path: string | undefined;
    if (sessionId && clients.size > 0) {
      const isExternal = (await compute()).sessions.some((s) => s.id === sessionId && s.external);
      if (isExternal) for (const a of accounts()) (path ??= findSessionFile(a.dir, sessionId));
    }
    if (seq !== previewSeq) return;
    if (!sessionId || !path) return stopTail();
    if (tail?.path === path) return;
    stopTail();
    const id = sessionId;
    tail = {
      sessionId: id,
      path,
      tailer: createTailer(path, (events) => {
        if (tail?.sessionId === id) broadcast({ type: 'tail', sessionId: id, events });
      }),
    };
    // The backfill callback ran inside createTailer, before `tail` was set.
    broadcast({ type: 'tail', sessionId: id, events: tail.tailer.events() });
  };

  /** The live sessions (terminal ptys) with the account and project the scan knows. */
  const liveRecords = async (): Promise<RunningRecord[]> => {
    const { sessions } = await compute();
    const byId = new Map(sessions.map((x) => [x.id, x]));
    const out: RunningRecord[] = [];
    const add = (id: string) => {
      const x = byId.get(id);
      if (x && !out.some((r) => r.id === id)) out.push({ id, account: x.account, project: x.project });
    };
    for (const id of liveTerminalIds()) add(id);
    return out;
  };
  /** The restore check (until decided; policy from the settings), then the write of the live set. */
  const syncRunning = async () => {
    try {
      if (!running) return;
      const l = await liveRecords();
      const { sessions } = await compute();
      const listed = new Set(sessions.map((x) => `${x.id}|${x.account}`));
      const policy = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents?.restoreSessions ?? 'ask';
      const liveIds = liveTerminalIds();
      running.decide(policy, liveIds, (r) => listed.has(`${r.id}|${r.account}`));
      running.sync(l);
    } catch {
      /* next tick */
    }
  };

  /** Set when live ptys reached the soft cap; the start is never blocked. */
  const capWarn = async (): Promise<AgentsCapWarn | undefined> => {
    const cap = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents?.softCap ?? DEFAULT_SOFT_CAP;
    const live = liveTerminalIds().length;
    return live >= cap ? { live, cap } : undefined;
  };

  const loadSeen = () => {
    if (seen) return seen;
    try {
      seen = JSON.parse(readFileSync(seenFile, 'utf8')) as Record<string, number>;
    } catch (e) {
      seen = {};
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') seenUnreadable = true;
    }
    return seen;
  };
  let seenUnreadable = false;
  const saveSeen = () => {
    if (seenUnreadable) return;
    try {
      mkdirSync(join(seenFile, '..'), { recursive: true });
      writeFileSync(seenFile, JSON.stringify(seen ?? {}));
    } catch {
      /* best effort */
    }
  };

  /** Stores the exact stamp of the session's current done / error as its seen mark (skipped when equal). */
  const acknowledge = (id: string) => {
    const stamp = tracker.stamp(id);
    if (stamp === undefined || loadSeen()[id] === stamp) return;
    loadSeen()[id] = stamp;
    saveSeen();
  };

  const registry = createAccountRegistry(home);
  const accounts = (): AgentAccount[] => registry.list();
  const activeOf = (accs: AgentAccount[], g: AgentsSettings | undefined) => resolveActiveAccount(accs, g?.['accounts.activeAccount']);

  const compute = async (quick = false) => {
    const accs = accounts();
    const agentsSettings = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents;
    const ownerView = { active: activeOf(accs, agentsSettings), showAllSessions: agentsSettings?.['accounts.showAllSessions'] !== false, shareProjects: agentsSettings?.['accounts.shareProjects'] !== false, showOwner: agentsSettings?.['accounts.showOwner'] === true };
    // Built with every owner's sessions (notifications cover hidden ones); `ownerView` filters the listed feed at the end.
    const allView = { ...ownerView, showAllSessions: true };
    const refs = projects?.list() ?? [];
    const capSetting = agentsSettings?.maxSessionsPerProject;
    const sessionCap = typeof capSetting === 'number' && capSetting >= 1 ? Math.floor(capSetting) : 10;
    const feedCap = Math.max(sessionCap, Math.floor(summaryLimitOf(agentsSettings)) || 0);
    const screenErrors = new Map<string, string>();
    for (const [id, lines] of opts.terminalScreens?.() ?? []) {
      const err = detectScreenError(lines);
      if (err) screenErrors.set(id, err.message);
    }
    const scans = accs.map((a) => scanPidFiles(a.dir));
    const pids = scans.flatMap((x) => x.live);
    const liveIds = new Set(pids.map((p) => p.sessionId));
    const hanging = new Set(scans.flatMap((x) => x.stale).map((p) => p.sessionId).filter((id) => !liveIds.has(id) && !liveTerminalIds().includes(id)));
    const lc = lifecycleStep(pids);
    const s = loadSeen();
    const statuses = tracker.update(pids, screenErrors, { seen: s, starting: lc.starting, exited: lc.exited.keys() });
    const statusOf = (id: string): AgentStatus => statuses.get(id) ?? tracker.offline(id, s);
    const external = externalIds(pids, liveTerminalIds());
    const usage = usageReader.read(accs, ownerView.active?.id);
    sevenDayHistory.observe(usage.accounts);
    void notifyLimits(usage.accounts);
    const views: AgentSessionView[] = applyAccountView(scanner
      .scan(accs.map((a) => ({ id: a.id, dir: a.dir })), quick, { projectPaths: refs.map((r) => r.path), perFolder: feedCap, keep: new Set([...statuses.keys(), ...claudeTerms().map((t) => t.sessionId)]) }, (m) => usage.windows.get(m))
      .map((x) => ({ ...x, lifecycle: lc.exited.has(x.id) ? ('exited' as const) : lc.starting.has(x.id) ? ('starting' as const) : undefined, exitCode: lc.exited.get(x.id), contextPercent: usageContextPercent(usage.bySession.get(x.id)) ?? x.contextPercent, startupContextPercent: usage.bySession.get(x.id)?.startupContextPercent, modelName: usage.bySession.get(x.id)?.model?.display_name, effort: usage.bySession.get(x.id)?.effort, claudeVersion: usage.bySession.get(x.id)?.version, status: statusOf(x.id), live: statuses.has(x.id) || undefined, external: external.has(x.id) || hanging.has(x.id) || undefined, hanging: hanging.has(x.id) || undefined, project: matchProject(x.cwd, refs)?.id, seenAt: s[x.id] }))
      .filter((x) => x.project !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt), accs, allView);
    if (agentsSettings?.autoSettle !== false) sessionState?.settle(views);
    // A pty whose session has no transcript yet (new, or after `/clear`): listed with the empty title until the first message.
    const sessionAccount = new Map(views.map((x) => [x.id, x.account]));
    const scannedIds: ReadonlySet<string> = new Set(views.map((x) => x.id));
    const scanned = new Set(scannedIds);
    for (const term of claudeTerms()) {
      if (scanned.has(term.sessionId) || !term.account) continue;
      if (lc.exited.get(term.sessionId) === 0) continue;
      scanned.add(term.sessionId);
      const project = matchProject(term.cwd, refs)?.id;
      if (project === undefined) continue;
      const lifecycle = lc.exited.has(term.sessionId) ? ('exited' as const) : lc.starting.has(term.sessionId) ? ('starting' as const) : undefined;
      // Before its first reading the session already carries the startup context (system prompt, tools, CLAUDE.md): its own, else the account's latest.
      const own = usage.bySession.get(term.sessionId);
      const startup = own?.startupContextPercent ?? [...usage.bySession.values()].filter((u) => u.startupContextPercent && u.startupContextPercent > 0 && sessionAccount.get(u.sessionId) === term.account).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.startupContextPercent;
      views.push(...applyAccountView([{ id: term.sessionId, account: term.account, cwd: term.cwd, title: '', firstPrompt: '', updatedAt: Date.now(), contextPercent: usageContextPercent(own) || (startup !== undefined ? Math.round(startup) : undefined), startupContextPercent: startup, modelName: usage.bySession.get(term.sessionId)?.model?.display_name, effort: usage.bySession.get(term.sessionId)?.effort, claudeVersion: usage.bySession.get(term.sessionId)?.version, status: statusOf(term.sessionId), live: statuses.has(term.sessionId) || undefined, project, lifecycle, exitCode: lc.exited.get(term.sessionId), seenAt: s[term.sessionId] }], accs, allView));
    }
    const everyOwner = views.map((x) => {
      const st = sessionState?.get(x.id);
      return { ...x, ...st, pinned: st?.pin === 'top' || undefined, statusSince: tracker.since(x.id, x.status, x.updatedAt) };
    });
    if (!quick) tracker.prune(everyOwner.map((x) => x.id));
    // The per-project cap counts only listed sessions (the account-filtered feed); new ptys without a transcript are never capped.
    const listed = ownerView.showAllSessions ? everyOwner : applyAccountView(everyOwner, accs, ownerView);
    const sessions = capPerProject(listed, feedCap, (x) => (scannedIds.has(x.id) ? (x.node ?? x.project) : undefined));
    const status: Record<string, AgentStatus> = {};
    for (const x of sessions) status[x.id] = x.status;
    void hooks.observe(sessions);
    void notifier.observe(everyOwner);
    alerts.observe(sessions);
    gitCwds = sessions.map((x) => x.cwd);
    const days = costDays(Date.now());
    const usageWithCost = withCost(usage.accounts, scanner.cost(days.today, days.yesterday, days.since), accs, ownerView.active?.id);
    return { sessions, status, usage: usageWithCost };
  };

  const broadcast = (frame: AgentsFrame) => {
    const text = JSON.stringify(frame);
    for (const ws of clients) ws.send(text);
  };

  const refresh = async (force = false) => {
    if (clients.size === 0) return;
    const { sessions, status, usage } = await compute();
    const usageKey = JSON.stringify(usage);
    if (force || usageKey !== last.usage) {
      last.usage = usageKey;
      broadcast({ type: 'usage', accounts: usage });
    }
    const statusKey = JSON.stringify(status);
    const listKey = JSON.stringify(sessions.map(({ status: _s, ...rest }) => rest));
    if (force || listKey !== last.sessions) {
      last = { ...last, sessions: listKey, status: statusKey };
      broadcast({ type: 'sessions', sessions });
    } else if (statusKey !== last.status) {
      last.status = statusKey;
      broadcast({ type: 'status', status });
    }
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void refresh(), DEBOUNCE_MS);
  };

  const start = () => {
    if (timer) return;
    for (const a of accounts()) {
      for (const sub of ['projects', 'sessions']) {
        try {
          watchers.push(watch(join(a.dir, sub), { recursive: true }, schedule));
        } catch {
          /* dir missing or unwatchable: the rescan covers it */
        }
      }
    }
    // Usage: a statusLine write refreshes at once; the timer catches resets passing (30 s), or polls (3 s) when the dir can't be watched.
    let usageWatched = false;
    if (usageDir) {
      try {
        mkdirSync(usageDir, { recursive: true });
        watchers.push(watch(usageDir, { recursive: true }, schedule));
        usageWatched = true;
      } catch {
        /* unwatchable: poll faster */
      }
    }
    usageTimer = setInterval(() => void refresh(), usageWatched ? USAGE_WATCHED_MS : USAGE_POLL_MS);
    timer = setInterval(() => void refresh(), opts.rescanMs ?? RESCAN_MS);
    if (opts.terminals) lifeTimer = setInterval(tick, LIFECYCLE_MS);
    git.start();
  };

  /** Every second: follows `/clear` (id adoption) and Starting / Exited; a change pushes a sessions frame. */
  const tick = () => {
    const r = lifecycleStep(accounts().flatMap((a) => readPidFiles(a.dir)));
    const key = JSON.stringify([[...r.starting], [...r.exited], claudeTerms().map((x) => x.sessionId)]);
    if (r.adopt.length === 0 && key === lastLife) return;
    lastLife = key;
    void refresh(true);
  };

  const stop = () => {
    for (const w of watchers) w.close();
    watchers = [];
    clearInterval(timer);
    clearInterval(usageTimer);
    usageTimer = undefined;
    clearTimeout(debounce);
    clearInterval(lifeTimer);
    git.stop();
    lifeTimer = undefined;
    timer = undefined;
  };

  let uiBroker: { confirm(o: { title: string; message: string; ok?: string; okKey?: string }): Promise<boolean> } | undefined;

  return defineServerView<AgentsServerSettings>({
    id: 'agents',
    icon: AGENTS_ICON,
    settings: {
      validate: { agents: validAgents },
      check: (patch, prev) => checkHookSettings(patch, prev, { approvals, confirm: opts.confirm ?? ((o) => (uiBroker ? uiBroker.confirm(o) : Promise.resolve(false))) }),
    },
    routes: (ctx) => {
      uiBroker = (ctx.stores as { ui?: { confirm(o: { title: string; message: string; ok?: string; okKey?: string }): Promise<boolean> } }).ui;
      approvalsFile = join(ctx.dataDir, 'agents', 'approved-hooks.json');
      claudeCommand.setApproved((key) => approvals.isApprovedSync(key));
      seenFile = join(ctx.dataDir, 'agents', 'seen.json');
      alertsDir = join(ctx.dataDir, 'agents', 'alerts');
      usageDir = join(ctx.dataDir, 'agents', 'usage');
      pruneUsage(usageDir);
      // Next to the usage folder, not inside it: the recursive usage watcher would refresh on each history write.
      historyFile = join(ctx.dataDir, 'agents', 'seven-day-history.json');
      const store = createProjectsStore(join(ctx.dataDir, 'agents', 'projects.json'));
      projects = store;
      const accountPrefs = createAccountPrefsStore(join(ctx.dataDir, 'agents', 'account-prefs.json'));
      const states = createSessionStateStore(join(ctx.dataDir, 'agents', 'session-state.json'));
      sessionState = states;
      const tree = createTreeStore(join(ctx.dataDir, 'agents', 'tree.json'));
      const notes = createNotesStore(join(ctx.dataDir, 'agents', 'notes'));
      loadSettings = () => ctx.settings.load();
      // Approvals load first so the sync check behind the launcher sees them.
      void Promise.all([loadSettings(), approvals.isApproved('').catch(() => false)]).then(([s]) => {
        claudeCommand.configure(s.agents);
        git.setEnabled(s.agents?.gitStatus !== false);
      }, () => {});
      running = createRunningStore(join(ctx.dataDir, 'agents', 'running.json'));
      clearInterval(runningTimer);
      runningTimer = setInterval(() => void syncRunning(), RUNNING_SYNC_MS);
      runningTimer.unref?.();
      const killTerminals = (sessionId: string) => {
        for (const x of claudeTerms()) if (x.sessionId === sessionId) opts.terminals?.close(x.id);
      };
      const launchOf = async (account: string, sessionId: string | undefined): Promise<AgentLaunch> => {
        const resume = sessionId !== undefined;
        const id = sessionId ?? crypto.randomUUID();
        const warn = await capWarn();
        void syncRunning();
        return { ok: true, sessionId: id, launch: { id: CLAUDE_LAUNCHER_ID, args: { account, sessionId: id, resume } }, warn };
      };
      const trash = createTrashStore(join(ctx.dataDir, 'agents', 'trash'));
      const undoStack: string[] = [];
      void loadSettings().then(
        (s) => trash.purge(s.agents?.trashRetentionDays ?? 30).catch(() => []),
        () => undefined,
      );
      const clearStatusFiles = (id: string) => {
        try {
          const root = join(ctx.dataDir, 'agents', 'usage');
          for (const d of readdirSync(root, { withFileTypes: true })) if (d.isDirectory()) rmSync(join(root, d.name, `${id}.json`), { force: true });
        } catch {
          // no status files
        }
      };
      const restoreOne = async (id: string): Promise<AgentRestoreResult> => {
        const r = await trash.restore(id).catch(() => ({ ok: false as const, error: 'gone' as const }));
        if (!r.ok) return r;
        const at = undoStack.lastIndexOf(id);
        if (at >= 0) undoStack.splice(at, 1);
        scanner.clear();
        void refresh(true);
        return { ok: true, id, title: r.entry.title };
      };
      const statusline = createStatuslineInstaller({ agentsDir: join(ctx.dataDir, 'agents'), ...opts.statusline });
      statusline.refresh();
      const layouts = createLayoutStore(join(ctx.dataDir, 'agents', 'layouts'));
      const rightSide = createRightSideStore(join(ctx.dataDir, 'agents'));
      const uiState = createUiStateStore(join(ctx.dataDir, 'agents'));
      const panelCtx: PanelCtx = {
        dataDir: ctx.dataDir,
        agentsDir: join(ctx.dataDir, 'agents'),
        settings: ctx.settings as PanelCtx['settings'],
        stores: ctx.stores,
        projects: () => store.list(),
        projectRoot: (project) => store.list().find((p) => p.id === project || projectKey(p.path) === projectKey(project))?.path,
        accountDirs: () => accounts().map((a) => a.dir),
        scanner,
        notify: (toast) => show({ launch: '', ...toast }),
      };
      // The panels' file and git routes over the Agents projects (not the Explorer's), keyed by the project's folder.
      const roots = async () => store.list().map((p) => ({ id: p.path, path: p.path }));
      const rooted = rootedFs({ roots });
      const pick = new Set(['GET /api/fs/list', 'GET /api/fs/stat', 'GET /api/fs/read', 'POST /api/fs/write', 'GET /api/git/status', 'GET /api/git/file', 'GET /api/editors', 'POST /api/editors/open']);
      const projectFs = Object.fromEntries(
        Object.entries({ ...rooted.routes, ...gitRoutes({ roots }), ...editorRoutes({ dir: ctx.dataDir, fs: rooted, picked: pickedPaths() }) })
          .filter(([key]) => pick.has(key))
          .map(([key, handler]) => [key.replace(' /api/', ' /api/agents/'), handler]),
      );
      return {
        ...panelRoutes(panelCtx),
        ...projectFs,
        // The workspace layout of one project (`?project=<path>`); `layout: null` when none is saved or the file is bad.
        'GET /api/agents/layout': async ({ query }) => ({ layout: (await layouts.read(query.get('project') ?? '')) ?? null }),
        'PUT /api/agents/layout': async ({ query, json }) => {
          const b = await json<{ layout?: unknown }>();
          if (!(await layouts.write(query.get('project') ?? '', b.layout))) throw invalid('layout', 'Not a workspace layout');
          return { ok: true };
        },
        // Right sidebar state of every scope (`""` = shared, else a project path): `{ [scope]: { list, open? } }`; PUT merges one scope.
        'GET /api/agents/right-side': async () => rightSide.read(),
        'PUT /api/agents/right-side': async ({ json }) => {
          const b = await json<{ scope?: unknown; value?: unknown }>();
          if (typeof b.scope !== 'string' || !(await rightSide.write(b.scope, b.value))) throw invalid('value', 'Not a right sidebar state');
          return { ok: true };
        },
        // Persistent UI state of the Agents screen: `{ [key]: object }`; PUT merges one key.
        'GET /api/agents/ui-state': async () => uiState.read(),
        'PUT /api/agents/ui-state': async ({ json }) => {
          const b = await json<{ key?: unknown; value?: unknown }>();
          if (!(await uiState.write(b.key, b.value))) throw invalid('value', 'Not a UI state value');
          return { ok: true };
        },
        // Rediscovers the accounts; `active` marks the one new sessions launch as.
        'GET /api/agents/accounts': async () => {
          const accs = accounts();
          const active = activeOf(accs, (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents);
          return accs.map((a) => ({ ...a, active: a === active || undefined }));
        },
        // Sets the active account (the default's config dir is stored as ""), saves it now and rebuilds the tree; the reply label feeds the flash.
        'POST /api/agents/accounts/active': async ({ json }): Promise<AgentActiveAccountResult> => {
          const b = (await json()) as Partial<AgentActiveAccountSet>;
          const acc = typeof b.dir === 'string' ? accountByDir(accounts(), b.dir) : undefined;
          if (!acc) return { ok: false, error: 'unknownAccount' };
          const cur = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents ?? {};
          await ctx.settings.save?.({ agents: { ...cur, 'accounts.activeAccount': acc.isDefault ? '' : acc.dir } });
          void refresh(true);
          return { ok: true, label: acc.label, account: { ...acc, active: true } };
        },
        // Add account: make `<home>/.claude-<name>`, link the checked entries, list it right away; with usage on, add the usage statusLine.
        'POST /api/agents/accounts/add': async ({ json }): Promise<AgentAccountAddResult> => {
          const b = await json<{ name?: unknown; share?: unknown }>();
          const r = addAccount(home, typeof b.name === 'string' ? b.name : '', shareList(b.share));
          if (!r.ok) return r;
          markPendingAccount(r.dir);
          const acc = accountByDir(accounts(), r.dir);
          if (!acc) return { ok: false, error: 'failed' };
          const agents = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents;
          if (agents?.['usage.show'] === true) statusline.install(acc);
          void refresh(true);
          return { ok: true, folder: r.folder, account: acc, linked: r.linked, unlinked: r.unlinked, skipped: r.skipped, skippedDevMode: r.skippedDevMode };
        },
        // Edit shared entries: which entries are links now; apply links missing ones and unlinks unwanted ones.
        'POST /api/agents/accounts/shared': async ({ json }): Promise<AgentAccountSharedResult> => {
          const b = await json<{ folder?: unknown }>();
          return readShared(home, typeof b.folder === 'string' ? b.folder : '');
        },
        'POST /api/agents/accounts/shared/apply': async ({ json }): Promise<AgentAccountApplyResult> => {
          const b = await json<{ folder?: unknown; share?: unknown }>();
          return applyShared(home, typeof b.folder === 'string' ? b.folder : '', shareList(b.share));
        },
        // Delete account (`<home>/.claude-<name>` only, never `.claude`); clears the active choice when it was active.
        'POST /api/agents/accounts/delete': async ({ json }): Promise<AgentAccountDeleteResult> => {
          const b = await json<{ folder?: unknown }>();
          const r = deleteAccount(home, typeof b.folder === 'string' ? b.folder : '');
          if (!r.ok) return r;
          forgetPendingAccount(r.dir);
          if (accountPrefs.remove(r.folder)) broadcast({ type: 'accountPrefs', prefs: accountPrefs.get() });
          const cur = (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents ?? {};
          const active = cur['accounts.activeAccount'];
          const wasActive = typeof active === 'string' && active !== '' && accountByDir([{ id: r.folder, dir: r.dir, label: r.folder, isDefault: false }], active) !== undefined;
          if (wasActive) await ctx.settings.save?.({ agents: { ...cur, 'accounts.activeAccount': '' } });
          void refresh(true);
          return { ok: true, folder: r.folder, wasActive };
        },
        // Per-account prefs (usage overrides, status icons): the whole map; PUT replaces it (strict validation) and tells open views.
        'GET /api/agents/accounts/prefs': () => accountPrefs.get(),
        'PUT /api/agents/accounts/prefs': async ({ json }): Promise<AccountPrefsSetResult> => {
          const b = await json<{ prefs?: unknown }>();
          if (!accountPrefs.set(b.prefs, accounts().map((a) => a.id))) return { ok: false, error: 'invalid' };
          broadcast({ type: 'accountPrefs', prefs: accountPrefs.get() });
          return { ok: true, prefs: accountPrefs.get() };
        },
        // Usage statusLine per account (Settings): install state, install (backup + chain the previous), uninstall (restore it).
        'GET /api/agents/statusline': () => statusline.statuses(accounts()),
        'POST /api/agents/statusline/install': async ({ json }) => {
          const b = await json<{ account?: unknown }>();
          const acc = accounts().find((a) => a.id === b.account);
          return acc ? statusline.install(acc) : { ok: false, error: 'unknownAccount' };
        },
        'POST /api/agents/statusline/uninstall': async ({ json }) => {
          const b = await json<{ account?: unknown }>();
          const acc = accounts().find((a) => a.id === b.account);
          return acc ? statusline.uninstall(acc) : { ok: false, error: 'unknownAccount' };
        },
        'GET /api/agents/alerts': () => alerts.list(),
        'GET /api/agents/sessions': async () => (await compute()).sessions,
        'GET /api/agents/projects': () => store.list(),
        // Explorer projects (the app's `projects` record store) not added yet.
        'GET /api/agents/projects/suggestions': async () => {
          const rs = ctx.stores.projects as { list(): Promise<Array<{ name: string; path: string }>> } | undefined;
          const have = new Set(store.list().map((p) => projectKey(p.path)));
          return ((await rs?.list()) ?? []).filter((p) => typeof p.path === 'string' && !have.has(projectKey(p.path))).map((p) => ({ name: p.name, path: p.path }));
        },
        // Pin / rename / archive one session (no path params in the router, so the id is in the body); '' or null clears the name.
        'PATCH /api/agents/session-state': async ({ json }) => {
          const b = await json<{ id?: unknown; pin?: unknown; pinned?: unknown; name?: unknown; archived?: unknown; tags?: unknown }>();
          if (!isUuid(b.id)) return { ok: false };
          states.set(b.id, b);
          await refresh(true);
          return { ok: true };
        },
        // Tag counts over the listed sessions (hidden projects are not listed).
        'GET /api/agents/tags': async () => tagCounts((await compute()).sessions),
        // Appends tags to each listed session id; never replaces.
        'POST /api/agents/tags/add': async ({ json }) => {
          const b = await json<{ ids?: unknown; tags?: unknown }>();
          if (!Array.isArray(b.ids)) return { ok: false };
          states.addTags(b.ids.filter(isUuid), b.tags);
          await refresh(true);
          return { ok: true };
        },
        // Removes one exact tag from every loaded session carrying it (archived included).
        'POST /api/agents/tags/remove': async ({ json }) => {
          const b = await json<{ tag?: unknown }>();
          if (typeof b.tag !== 'string' || !b.tag) return { ok: false, count: 0 };
          const count = states.removeTag(b.tag, (await compute()).sessions.map((s) => s.id));
          if (count) await refresh(true);
          return { ok: true, count };
        },
        // Sidebar tree (folders, manual orders, collapse, sort, view); PATCH takes one AgentTreePatch and replies {ok, error?, tree}.
        'GET /api/agents/tree': () => tree.read(),
        'PATCH /api/agents/tree': async ({ json }) => tree.patch(await json<AgentTreePatch>()),
        // Per-project markdown notes (the id is in the query / body: no path params).
        'GET /api/agents/notes': ({ query }) => ({ text: notes.read(query.get('project') ?? '') }),
        'PUT /api/agents/notes': async ({ json }) => {
          const b = await json<{ project?: unknown; text?: unknown }>();
          if (typeof b.project !== 'string' || typeof b.text !== 'string') return { ok: false };
          return { ok: notes.write(b.project, b.text) };
        },
        // Full-text search of prompts and assistant text in the added projects' sessions: ndjson of {sessionId, snippet}.
        'GET /api/agents/search': async ({ req, query }) => {
          const q = query.get('q') ?? '';
          const accs = accounts();
          const files: Array<{ id: string; file: string }> = [];
          const byAccount = new Map<string, Map<string, string>>();
          const filesOf = (dir: string) => {
            let m = byAccount.get(dir);
            if (!m) byAccount.set(dir, (m = sessionFilesOf(dir)));
            return m;
          };
          for (const x of (await compute()).sessions) {
            const dir = accs.find((a) => a.id === x.account)?.dir;
            const file = dir ? filesOf(dir).get(x.id) : undefined;
            if (file) files.push({ id: x.id, file });
          }
          return ndjson(req, (emit, signal) => searchSessions(files, q, emit, signal));
        },
        // Read-only transcript of a session (external sessions open it instead of a terminal).
        'GET /api/agents/history': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) return { events: loadHistory(file) };
          }
          return { events: [] };
        },
        // The last assistant message with text (read on demand, not cached).
        'GET /api/agents/last-response': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) return { text: lastResponse(file) };
          }
          return { text: null };
        },
        'GET /api/agents/skills': async ({ url }) => {
          const accs = accounts();
          const active = activeOf(accs, (await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents);
          const dir = active?.dir;
          return { account: active?.id ?? '', ...(dir ? listScoped(dir, url?.searchParams.get('folder') || undefined) : { skills: [], agents: [] }) } satisfies { account: string; skills: AgentSkill[]; agents: AgentLocal[] };
        },
        'GET /api/agents/trace': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) {
              let windows: Map<string, number> | undefined;
              const windowOf = (m: string) => (windows ??= usageReader.read(accounts(), undefined).windows).get(m);
              const subagents = subagentsOf(file, windowOf);
              return { ...readTraceFull(file, windowOf), ...(subagents.length > 0 ? { subagents } : {}) };
            }
          }
          return { steps: [] };
        },
        // One subagent's own steps (`runId` for an agent of a workflow run).
        'GET /api/agents/trace/agent': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          const agentId = url?.searchParams.get('agentId') ?? '';
          const runId = url?.searchParams.get('runId') || undefined;
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (!file) continue;
            const sub = subagentFile(file, agentId, runId);
            if (!sub) return { steps: [] };
            let windows: Map<string, number> | undefined;
            const { steps, cwd } = readTraceFull(sub, (m) => (windows ??= usageReader.read(accounts(), undefined).windows).get(m));
            return { steps: steps.map(({ sidechain: _s, ...s }) => s), ...(cwd ? { cwd } : {}) };
          }
          return { steps: [] };
        },
        'GET /api/agents/trace/files': async ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) {
              const { steps, cwd } = readTraceFull(file);
              const [status, recovered] = await Promise.all([fileStatus(steps, cwd), recoverShellChanges(steps, cwd)]);
              return { status, disk: diskCheck(steps), ...(recovered.length > 0 ? { recovered } : {}) };
            }
          }
          return { status: {}, disk: {} };
        },
        'GET /api/agents/trace/siblings': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (file) return { sessions: siblingList(file) };
          }
          return { sessions: [] };
        },
        'GET /api/agents/trace/compare': ({ url }) => {
          const id = url?.searchParams.get('sessionId') ?? '';
          const withId = url?.searchParams.get('with') ?? '';
          for (const a of accounts()) {
            const file = findSessionFile(a.dir, id);
            if (!file) continue;
            const current = summaryOf(id, readTraceFull(file).steps);
            const sibs = siblingFiles(file);
            if (withId && withId !== 'project') {
              const other = sibs.find((x) => x.id === withId);
              const summary = other ? summaryOfFile(other.id, other.file) : undefined;
              return { current, ...(summary ? { other: summary } : {}), count: summary ? 1 : 0 };
            }
            const list = sibs.flatMap((x) => summaryOfFile(x.id, x.file) ?? []);
            const other = averageOf(list);
            return { current, ...(other ? { other } : {}), count: list.length };
          }
          return { count: 0 };
        },
        'GET /api/agents/recovery': async () => {
          await syncRunning();
          const auto = ((await loadSettings().catch(() => ({}) as AgentsServerSettings)).agents?.restoreSessions ?? 'ask') === 'always';
          const { sessions } = await compute();
          const byId = new Map(sessions.map((x) => [x.id, x]));
          const live = liveTerminalIds();
          return (running?.recovery(live) ?? []).flatMap((r): AgentRunning[] => {
            const x = byId.get(r.id);
            return x ? [{ ...r, project: x.project, title: x.title, cwd: x.cwd, ...(auto ? { auto: true } : {}) }] : [];
          });
        },
        'GET /api/agents/cap': async () => ({ warn: await capWarn() }),
        'POST /api/agents/recovery/dismiss': () => {
          running?.dismiss();
          return { ok: true };
        },
        'POST /api/agents/projects': async ({ json }) => {
          const p = store.add(await json<{ name?: unknown; path?: unknown }>());
          if (p) void refresh(true);
          return p ? { ok: true, project: p } : { ok: false };
        },
        'DELETE /api/agents/projects': ({ url }) => {
          const ok = store.remove(url?.searchParams.get('id') ?? '');
          if (ok) void refresh(true);
          return { ok };
        },
        // Terminal mode: returns the launcher args for `POST /api/terminal/open`. A new session gets its id here
        // (`--session-id`), so the pty is linked to it from the start through `meta.agentSession`.
        // `dir` (the cwd the pty will start in) is checked: a missing folder starts nothing.
        'POST /api/agents/terminal/prepare': async ({ json }): Promise<AgentLaunch> => {
          const b = await json<{ account?: unknown; sessionId?: unknown; dir?: unknown }>();
          if (typeof b.dir === 'string' && b.dir) {
            const bad = cwdProblem(b.dir);
            if (bad) return { ok: false, ...bad };
          }
          const acc = accounts().find((a) => a.id === b.account);
          if (!acc) return { ok: false, error: 'unknownAccount' };
          return launchOf(acc.id, typeof b.sessionId === 'string' && b.sessionId !== '' ? b.sessionId : undefined);
        },
        // Stop: acknowledges done / error, kills the agent; `removed` when nothing was ever sent (no transcript).
        'POST /api/agents/session/stop': async ({ json }): Promise<AgentStopResult> => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false, error: 'unknownSession' };
          acknowledge(b.sessionId);
          killTerminals(b.sessionId);
          void refresh(true);
          return { ok: true, ...stopOutcome(hasTranscript(b.sessionId)) };
        },
        // Delete: sessions go to the trash (preferences stay for a restore). `id` or `ids`; each id is deleted or skipped with a code.
        'POST /api/agents/session/delete': async ({ json }): Promise<AgentDeleteResult> => {
          const b = await json<{ id?: unknown; ids?: unknown }>();
          const ids = Array.isArray(b.ids) ? b.ids : [b.id];
          const out: AgentDeleteResult = { deleted: [], skipped: [] };
          const pids = accounts().flatMap((a) => readPidFiles(a.dir));
          const views = (await compute()).sessions;
          for (const raw of new Set(ids)) {
            const id = typeof raw === 'string' ? raw : '';
            const runningNow = id !== '' && (liveTerminalIds().includes(id) || pids.some((p) => p.sessionId === id));
            if (runningNow) {
              out.skipped.push({ id, error: 'running' });
              continue;
            }
            const acc = isSafeId(id) ? accounts().find((a) => findSessionFile(a.dir, id) !== undefined) : undefined;
            const file = acc ? findSessionFile(acc.dir, id) : undefined;
            if (!file) {
              out.skipped.push({ id, error: 'nothing' });
              continue;
            }
            const view = views.find((x) => x.id === id);
            try {
              await trash.trash({ id, file, agent: 'claude', title: view?.title || view?.firstPrompt || '' });
            } catch {
              out.skipped.push({ id, error: 'nothing' });
              continue;
            }
            clearStatusFiles(id);
            killTerminals(id);
            undoStack.push(id);
            out.deleted.push(id);
          }
          if (out.deleted.length) {
            scanner.clear();
            void syncRunning();
            void refresh(true);
          }
          return out;
        },
        'GET /api/agents/usage/history': (): AgentSevenDayHistory => sevenDayHistory.get(),
        'GET /api/agents/trash': (): Promise<AgentTrashEntry[]> => trash.list(),
        'POST /api/agents/trash/restore': async ({ json }): Promise<AgentRestoreResult> => {
          const b = await json<{ id?: unknown }>();
          return restoreOne(typeof b.id === 'string' ? b.id : '');
        },
        // Undo: restores the most recently deleted session (this run only); `empty` when none is left.
        'POST /api/agents/trash/undo': async (): Promise<AgentRestoreResult> => {
          const id = undoStack[undoStack.length - 1];
          if (id === undefined) return { ok: false, error: 'empty' };
          return restoreOne(id);
        },
        // Restart: ends the old process and returns the launch of a new run (a fresh id when there is no transcript to resume).
        'POST /api/agents/session/restart': async ({ json }): Promise<AgentLaunch> => {
          const b = await json<{ sessionId?: unknown }>();
          const id = typeof b.sessionId === 'string' ? b.sessionId : '';
          const found = (await compute()).sessions.find((x) => x.id === id);
          const plan = planRestart({ known: !!found, external: found?.external === true, sessionId: id, hasTranscript: hasTranscript(id) });
          if (!plan.ok || !found) return { ok: false, error: plan.ok ? 'unknownSession' : plan.error };
          const bad = cwdProblem(found.cwd);
          if (bad) return { ok: false, ...bad };
          killTerminals(id);
          return { ...(await launchOf(found.account, plan.resume ? plan.sessionId : undefined)), cwd: found.cwd };
        },
        // Take over: ends the other terminal's Claude process (its pid file) so the session can resume here.
        'POST /api/agents/session/takeover': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          const id = typeof b.sessionId === 'string' ? b.sessionId : '';
          const scans = accounts().map((a) => scanPidFiles(a.dir));
          const pids = scans.flatMap((x) => x.live).filter((e) => e.sessionId === id);
          const stale = scans.flatMap((x) => x.stale).filter((e) => e.sessionId === id);
          if ((!pids.length && !stale.length) || !(await compute()).sessions.some((x) => x.id === id && x.external)) return { ok: false };
          // A stale file has no Claude process (its pid may belong to another program): only the file goes, never a kill.
          for (const e of stale) for (const f of e.files) rmSync(f, { force: true });
          for (const e of pids) {
            try {
              process.kill(e.pid);
            } catch { /* already gone */ }
          }
          for (let i = 0; i < 30 && pids.some((e) => isPidAlive(e.pid)); i++) await new Promise((r) => setTimeout(r, 100));
          await refresh(true);
          return { ok: !pids.some((e) => isPidAlive(e.pid)) };
        },
        'POST /api/agents/seen': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false };
          acknowledge(b.sessionId);
          await refresh(true);
          return { ok: true };
        },
        // Mark unread: done / error clear the seen mark; no status writes a fresh done; running / waiting do nothing.
        'POST /api/agents/unread': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          if (typeof b.sessionId !== 'string' || !b.sessionId) return { ok: false };
          const id = b.sessionId;
          const st = (await compute()).status[id];
          if (st === 'running' || st === 'needs-you' || st === 'starting') return { ok: true };
          if (tracker.stamp(id) === undefined) tracker.forceDone(id);
          else if (loadSeen()[id] !== undefined) {
            delete loadSeen()[id];
            saveSeen();
          }
          await refresh(true);
          return { ok: true };
        },
        // The web reports which session is on screen (null when the Agents view is hidden or the window unfocused).
        'POST /api/agents/shown': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          shownId = typeof b.sessionId === 'string' && b.sessionId ? b.sessionId : undefined;
          return { ok: true };
        },
        // The web reports the session whose external transcript is previewed (null when none); one tailer follows it.
        'POST /api/agents/preview': async ({ json }) => {
          const b = await json<{ sessionId?: unknown }>();
          await syncTail(typeof b.sessionId === 'string' && b.sessionId ? b.sessionId : undefined);
          return { ok: true };
        },
        'POST /api/agents/socket-ticket': () => ({ ticket: tickets.issue(true) }),
      };
    },
    sockets: (): SocketRoutes => ({
      [AGENTS_SOCKET_PATH]: {
        tickets,
        open(ws) {
          clients.add(ws);
          start();
          void compute(true).then(({ sessions, usage }) => {
            ws.send(JSON.stringify({ type: 'sessions', sessions } satisfies AgentsFrame));
            setTimeout(() => void refresh(true), 300);
            ws.send(JSON.stringify({ type: 'usage', accounts: usage } satisfies AgentsFrame));
            ws.send(JSON.stringify({ type: 'git', status: git.get() } satisfies AgentsFrame));
            void git.pollNow();
          });
          if (tail) ws.send(JSON.stringify({ type: 'tail', sessionId: tail.sessionId, events: tail.tailer.events() } satisfies AgentsFrame));
        },
        message() {},
        close(ws) {
          clients.delete(ws);
          if (clients.size === 0) {
            shownId = undefined;
            previewSeq++;
            stopTail();
            stop();
          }
        },
      },
    }),
    quitGuard() {
      const live = new Set(liveTerminalIds());
      const count = tracker.busy().filter((id) => live.has(id)).length;
      return count > 0 ? t('agents.quit.confirm', { count }) : undefined;
    },
    onQuit() {
      running?.setQuitting();
      stop();
      clearInterval(runningTimer);
      clearInterval(lifeTimer);
      for (const x of claudeTerms()) opts.terminals?.close(x.id);
    },
  });
}
