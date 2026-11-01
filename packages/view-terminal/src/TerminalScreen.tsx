import { useEffect, useRef, useState } from 'react';
import {
  closeSession,
  formatTabTitle,
  listProfiles,
  listSessions,
  type SessionInfo,
  type TerminalPaneHandle,
  type TerminalProfileInfo,
  TerminalPane,
  terminalAppKeys,
} from '@kedalion/terminal';
import { SHELL_ICONS, SHELL_NAMES } from '@kedalion/terminal/protocol';
import {
  activate,
  activeTab,
  addTab,
  closeTabs,
  focusedPane,
  nudgeSplit,
  paneInDirection,
  type PaneDirection,
  splitPane,
  type ContextMenuItem,
  IconPicker,
  type IconName,
  type Layout,
  navigate,
  newTab,
  restore,
  serialize,
  singlePane,
  type Tab,
  type TabContext,
  TabWorkspace,
  useCommand,
  useDebouncedSave,
  useDialogs,
  useKeybindings,
} from '@kedalion/ui';
import { TERMINAL_SCREEN_COMMANDS, terminalCommandById } from './commands';
import { t } from './i18n';
import { type TerminalViewSettings as Settings, terminalSettingsOf } from './settings';
import './terminal-screen.css';

/**
 * A terminal tab: the session it shows (none: opens one), the project folder a new one starts in, the
 * user's name and icon for it, its profile (none: the default one) and its last known folder.
 */
interface Route {
  kind: 'terminal';
  session?: string;
  root?: string;
  path?: string;
  name?: string;
  icon?: string;
  profile?: string;
  /** Last absolute folder of the shell; a restart opens the new shell there. */
  dir?: string;
}

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';

const isRoute = (x: unknown): x is Route => {
  const r = x as Partial<Route> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    r.kind === 'terminal' &&
    [r.session, r.root, r.path, r.name, r.icon, r.profile, r.dir].every(optionalString)
  );
};

const newRoute = (): Route => ({ kind: 'terminal' });

const sessionIds = (layout: Layout<Route>) =>
  new Map(layout.panes.flatMap((p) => p.tabs.filter((x) => x.route.session).map((x) => [x.route.session as string, x.id] as const)));

/**
 * `next` with a fresh shell in every new tab that copies another tab's session (split): two
 * interactive views of one session would take it from each other.
 */
function dropCopiedSessions(prev: Layout<Route>, next: Layout<Route>): Layout<Route> {
  const owners = sessionIds(prev);
  let out = next;
  for (const pane of next.panes) {
    for (const tab of pane.tabs) {
      const owner = tab.route.session && owners.get(tab.route.session);
      if (owner && owner !== tab.id) out = navigate(out, tab.id, { ...tab.route, session: undefined }, { replace: true });
    }
  }
  return out;
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Clears the bell marker once the tab is shown. */
function Seen({ visible, onSeen }: { visible: boolean; onSeen: () => void }) {
  useEffect(() => {
    if (visible) onSeen();
  }, [visible]);
  return null;
}

export function TerminalScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const term = terminalSettingsOf(settings);
  const [layout, setLayout] = useState<Layout<Route>>(
    () => (term.restoreTabs ? restore(settings.terminalLayout, isRoute) : null) ?? singlePane(newTab(newRoute())),
  );
  const latest = useRef(layout);
  latest.current = layout;
  /** Titles the programs set (OSC 0/2), by session id. */
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** Folders the shells reported (OSC 7), by session id. */
  const [cwds, setCwds] = useState<Record<string, string>>({});
  /** Sessions that rang the bell since their tab was last shown. */
  const [rang, setRang] = useState<Record<string, boolean>>({});
  const running = useRef<Record<string, boolean>>({});
  const [infos, setInfos] = useState<Record<string, SessionInfo>>({});
  const [profiles, setProfiles] = useState<TerminalProfileInfo[]>([]);
  const [iconTab, setIconTab] = useState<string | null>(null);
  const dialogs = useDialogs();
  const keys = useKeybindings();
  /** Bell count of each session when the user last saw it in the menu. */
  const seenBells = useRef<Record<string, number>>({});
  /** Each mounted pane's handle, by tab id (tab menu: clear, zoom). */
  const handles = useRef(new Map<string, TerminalPaneHandle>());
  const [newMenuRequest, setNewMenuRequest] = useState<{ pane: string; n: number }>();

  const save = useDebouncedSave((next: Layout<Route>) => onSave({ terminalLayout: serialize(next) }));
  const change = (raw: Layout<Route>) => {
    const prev = latest.current;
    const next = dropCopiedSessions(prev, raw);
    latest.current = next;
    setLayout(next);
    save(next);
    const kept = sessionIds(next);
    const closed = [...sessionIds(prev).keys()].filter((id) => !kept.has(id));
    for (const id of closed) {
      void closeSession(id).catch(() => {});
      delete running.current[id];
      delete seenBells.current[id];
    }
    if (closed.length) {
      const without = <T,>(rec: Record<string, T>) => {
        if (!closed.some((id) => id in rec)) return rec;
        const out = { ...rec };
        for (const id of closed) delete out[id];
        return out;
      };
      setTitles(without);
      setCwds(without);
      setRang(without);
    }
  };

  const refresh = async () => {
    const list = await listSessions();
    setInfos(Object.fromEntries(list.map((s) => [s.id, s])));
    return list;
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  useEffect(() => {
    void listProfiles().then(setProfiles, () => {});
  }, [settings.terminal]);

  const tabOf = (tabId: string) => latest.current.panes.flatMap((p) => p.tabs).find((x) => x.id === tabId);
  const paneOf = (tabId: string) => latest.current.panes.find((p) => p.tabs.some((x) => x.id === tabId))?.id;
  /** Changes the tab's route in place (no Back entry). */
  const patchRoute = (tabId: string, patch: Partial<Route>) => {
    const tab = tabOf(tabId);
    if (tab) change(navigate(latest.current, tabId, { ...tab.route, ...patch }, { replace: true }));
  };

  const onSession = (tabId: string, session: string) => {
    const tab = tabOf(tabId);
    if (!tab || tab.route.session === session) return;
    // Replace, not push: Back to the route without a session would open another shell.
    patchRoute(tabId, { session });
    void refresh().catch(() => {});
  };

  const onCwd = (tabId: string, cwd: string) => {
    const tab = tabOf(tabId);
    if (!tab) return;
    if (tab.route.session) setCwds((m) => (m[tab.route.session!] === cwd ? m : { ...m, [tab.route.session!]: cwd }));
    if (tab.route.dir !== cwd) patchRoute(tabId, { dir: cwd });
  };

  const defaultProfileId = term.defaultProfile || (settings.terminal?.shell && settings.terminal.shell !== 'auto' ? settings.terminal.shell : undefined);
  const profileOf = (route: Route, info?: SessionInfo) => {
    const id = route.profile ?? info?.profile ?? defaultProfileId;
    return profiles.find((p) => p.id === id) ?? (info?.shell ? profiles.find((p) => p.id === info.shell) : undefined);
  };
  const profileIcon = (p?: TerminalProfileInfo, shell?: string): IconName =>
    (p?.icon || (shell && SHELL_ICONS[shell as keyof typeof SHELL_ICONS]) || 'terminal') as IconName;
  const cwdOf = (route: Route) => (route.session && (cwds[route.session] || infos[route.session]?.cwd)) || route.dir;

  const titleOf = (route: Route) => {
    const info = route.session ? infos[route.session] : undefined;
    const profile = profileOf(route, info);
    const shell = info?.shell ?? (profile?.shell !== 'custom' ? profile?.shell : undefined);
    const cwd = cwdOf(route);
    const bell = route.session && rang[route.session] ? '● ' : '';
    const icon = (route.icon as IconName | undefined) ?? profileIcon(profile, shell);
    const tooltip = [cwd, profile?.name].filter(Boolean).join(' · ') || undefined;
    if (route.name) return { title: bell + route.name, tooltip, icon };
    const title = formatTabTitle(term.tabTitle, {
      name: profile?.name ?? info?.label,
      shell: shell ? (SHELL_NAMES[shell as keyof typeof SHELL_NAMES] ?? shell) : undefined,
      folder: cwd ? basename(cwd) : undefined,
      cwd,
      title: (route.session && titles[route.session]) || info?.title,
    });
    return { title: bell + (title || t('terminalScreen.tab')), tooltip, icon };
  };

  const rename = async (tab: Tab<Route>) => {
    const value = await dialogs.prompt({
      title: t('terminalScreen.rename.title'),
      label: t('terminalScreen.rename.label'),
      value: tab.route.name ?? titleOf(tab.route).title.replace(/^● /, ''),
    });
    if (value !== null) patchRoute(tab.id, { name: value.trim() || undefined });
  };

  const duplicate = (tab: Tab<Route>) =>
    change(addTab(latest.current, newTab<Route>({ kind: 'terminal', profile: tab.route.profile, dir: cwdOf(tab.route) }), paneOf(tab.id)));

  /** Splits the active tab's pane; the new pane opens profile `profile` (none: the default one). */
  const splitWith = (side: 'right' | 'down', profile?: string) => {
    const prev = latest.current;
    const next = splitPane(prev, activeTab(prev).id, side);
    if (next === prev) return;
    const added = activeTab(next);
    change(navigate(next, added.id, { kind: 'terminal', profile }, { replace: true }));
  };
  const openProfiles = () => profiles.filter((p) => p.available && !p.hidden);

  const screenCommands: Record<string, () => void> = {
    'terminal.splitRight': () => splitWith('right'),
    'terminal.splitDown': () => splitWith('down'),
    'terminal.newTabMenu': () => setNewMenuRequest((r) => ({ pane: latest.current.focused, n: (r?.n ?? 0) + 1 })),
  };
  for (const dir of ['left', 'right', 'up', 'down'] as PaneDirection[]) {
    const name = dir[0].toUpperCase() + dir.slice(1);
    screenCommands[`terminal.focus${name}`] = () => {
      const l = latest.current;
      const pane = paneInDirection(l, dir);
      const target = pane && l.panes.find((x) => x.id === pane);
      if (target) change(activate(l, target.id, target.active));
    };
    screenCommands[`terminal.resize${name}`] = () => change(nudgeSplit(latest.current, dir));
  }
  for (let i = 0; i < 9; i++) {
    screenCommands[`terminal.newTabProfile${i + 1}`] = () => {
      const p = openProfiles()[i];
      if (p) change(addTab(latest.current, newTab<Route>({ kind: 'terminal', profile: p.id }), focusedPane(latest.current).id));
    };
  }
  // A fixed list, so the hook order is fixed.
  for (const id of TERMINAL_SCREEN_COMMANDS) useCommand(terminalCommandById(id), () => screenCommands[id]?.());

  const paneRun = (tab: Tab<Route>, command: Parameters<TerminalPaneHandle['run']>[0]) => () => handles.current.get(tab.id)?.run(command);

  const menuOf = (route: Route, tab: Tab<Route>): Array<ContextMenuItem | 'sep'> => [
    { id: 'rename', label: t('terminalScreen.rename'), icon: 'edit', run: () => void rename(tab) },
    ...(route.name ? [{ id: 'resetName', label: t('terminalScreen.resetName'), run: () => patchRoute(tab.id, { name: undefined }) }] : []),
    { id: 'icon', label: t('terminalScreen.changeIcon'), run: () => setIconTab(tab.id) },
    ...(route.icon ? [{ id: 'defaultIcon', label: t('terminalScreen.defaultIcon'), run: () => patchRoute(tab.id, { icon: undefined }) }] : []),
    { id: 'duplicate', label: t('terminalScreen.duplicate'), icon: 'copy', run: () => duplicate(tab) },
    'sep',
    { id: 'clear', label: t('terminalScreen.clear'), run: paneRun(tab, 'terminal.clear') },
    { id: 'zoomIn', label: t('terminalScreen.zoomIn'), run: paneRun(tab, 'terminal.zoomIn') },
    { id: 'zoomOut', label: t('terminalScreen.zoomOut'), run: paneRun(tab, 'terminal.zoomOut') },
    { id: 'zoomReset', label: t('terminalScreen.zoomReset'), run: paneRun(tab, 'terminal.zoomReset') },
  ];

  const newMenu = (paneId: string): Array<ContextMenuItem | 'sep'> => {
    void refresh().catch(() => {});
    const open = (route: Route) => change(addTab(latest.current, newTab<Route>(route), paneId));
    const profileItems: ContextMenuItem[] = openProfiles()
      .map((p) => ({
        id: `profile:${p.id}`,
        label: p.name,
        icon: profileIcon(p, p.shell),
        hint: p.id === defaultProfileId ? t('terminalScreen.default') : undefined,
        run: () => open({ kind: 'terminal', profile: p.id }),
      }));
    const shown = sessionIds(latest.current);
    const sessions: ContextMenuItem[] = Object.values(infos)
      .filter((s) => !shown.has(s.id))
      .map((s) => {
        const bell = s.bells > (seenBells.current[s.id] ?? 0);
        return {
          id: s.id,
          label: `${bell ? '● ' : ''}${s.label} · ${basename(s.cwd)}`,
          hint: s.title || undefined,
          icon: 'terminal',
          run: () => {
            seenBells.current[s.id] = s.bells;
            open({ kind: 'terminal', session: s.id });
          },
        };
      });
    return [
      ...profileItems,
      ...(profileItems.length ? (['sep'] as const) : []),
      ...(sessions.length ? sessions : [{ id: 'none', label: t('terminalScreen.sessions.none'), disabled: true, run: () => {} }]),
      'sep',
      { id: 'splitRight', label: t('terminalScreen.splitRight'), icon: 'split', run: () => splitWith('right') },
      { id: 'splitDown', label: t('terminalScreen.splitDown'), icon: 'split-down', run: () => splitWith('down') },
      'sep',
      { id: 'settings', label: t('terminalScreen.settings'), icon: 'settings', run: () => void (window.location.hash = '#/settings/terminal.profiles') },
    ];
  };

  const confirmClose = async (tabs: Tab<Route>[]) => {
    if (!term.confirmCloseRunning) return true;
    const list = await refresh().catch(() => Object.values(infos));
    const byId = new Map(list.map((s) => [s.id, s]));
    const busy = tabs.filter((x) => x.route.session && (running.current[x.route.session] || byId.get(x.route.session)?.running));
    if (!busy.length) return true;
    return dialogs.confirm({
      title: t('terminalScreen.confirmRunning.title'),
      body: busy.length === 1 ? t('terminalScreen.confirmRunning', { name: titleOf(busy[0].route).title }) : t('terminalScreen.confirmRunningMany', { count: busy.length }),
      okLabel: t('terminalScreen.close'),
      danger: true,
    });
  };

  const closeTab = (tabId: string) => change(closeTabs(latest.current, [tabId], () => newTab(newRoute())));
  const sessionOf = (tabId: string) => tabOf(tabId)?.route.session;
  const iconRoute = iconTab ? tabOf(iconTab)?.route : undefined;

  const workspace = (
      <TabWorkspace
        confirmCloseDirty={settings.general?.confirmCloseDirty ?? true}
        confirmClose={confirmClose}
        layout={layout}
        onChange={change}
        titleOf={titleOf}
        menuOf={menuOf}
        newMenu={newMenu}
        newMenuRequest={newMenuRequest}
        onTabDoubleClick={(tab) => {
          void rename(tab);
          return true;
        }}
        newRoute={newRoute}
        scope="terminal"
        renderTab={(tab: Tab<Route>, ctx: TabContext<Route>) => (
          <>
            <Seen
              visible={ctx.visible}
              onSeen={() => {
                const s = tab.route.session;
                if (s && rang[s]) setRang(({ [s]: _, ...rest }) => rest);
              }}
            />
            <TerminalPane
              session={tab.route.session}
              appearance={profileOf(tab.route, tab.route.session ? infos[tab.route.session] : undefined)?.appearance}
              shell={tab.route.session ? infos[tab.route.session]?.shell : undefined}
              focused={ctx.focused || (layout.panes.length > 1 ? false : undefined)}
              handle={(h) => {
                if (h) handles.current.set(tab.id, h);
                else handles.current.delete(tab.id);
              }}
              cwd={tab.route.root !== undefined ? { root: tab.route.root, path: tab.route.path ?? '' } : undefined}
              profile={tab.route.profile ?? (term.defaultProfile || undefined)}
              dir={tab.route.dir}
              restartOnExit={term.onExit === 'restart'}
              onSession={(id) => onSession(tab.id, id)}
              appKeys={terminalAppKeys('terminal', keys?.defs ?? [], TERMINAL_SCREEN_COMMANDS)}
              onTitle={(title) => {
                const session = sessionOf(tab.id);
                if (session) setTitles((m) => ({ ...m, [session]: title }));
              }}
              onCwd={(cwd) => onCwd(tab.id, cwd)}
              onRunning={(on) => {
                const session = sessionOf(tab.id);
                if (session) running.current[session] = on;
              }}
              onBell={() => {
                const session = sessionOf(tab.id);
                if (!session || ctx.visible || (term.bellStyle !== 'tab' && term.bellStyle !== 'both')) return;
                setRang((m) => (m[session] ? m : { ...m, [session]: true }));
              }}
              onExit={(code) => {
                if (term.onExit === 'close' || (term.onExit === 'closeIfClean' && code === 0)) closeTab(tab.id);
              }}
            />
          </>
        )}
      />
  );
  const extras = (
    <>
      {iconTab && (
        <IconPicker
          value={iconRoute?.icon as IconName | undefined}
          onPick={(icon) => {
            patchRoute(iconTab, { icon });
            setIconTab(null);
          }}
          onClose={() => setIconTab(null)}
        />
      )}
      {dialogs.element}
    </>
  );

  return (
    <div className="terminal-screen screen-edges">
      {workspace}
      {extras}
    </div>
  );
}
