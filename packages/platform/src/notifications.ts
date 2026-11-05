import { homedir } from 'node:os';
import { join } from 'node:path';
import { VIEW_ICON_SVGS } from '@kedalion/ui/view-icons';
import { DEFAULT_ICON_COLOR, iconPng } from './win/icon-png.ts';
import { createToaster, type Toast, type Toaster } from './win/toast.ts';

export { setEmbeddedToastIcons } from './win/icon-png.ts';

/** Renders the toast badge of every view icon into `dir`; returns the file of each view id (for the build to embed). */
export async function renderToastIcons(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, svg] of Object.entries(VIEW_ICON_SVGS)) {
    const file = await iconPng({ name, svg, color: DEFAULT_ICON_COLOR, dir });
    if (!file) throw new Error(`could not render the toast icon of ${name}`);
    out[name] = file;
  }
  return out;
}

export interface NotificationsOptions {
  /** Used as the title of a notification without one. */
  appName: string;
  /** App link for a path (`StartContext.link`), read when a notification is sent; without it a click has no target. */
  link: () => ((path: string) => string) | undefined;
  /** True while notifications are muted (do not disturb). */
  dnd?: () => boolean | Promise<boolean>;
  /** Badge colour of the icons, `#rrggbb`. */
  color?: string;
  /** Where rendered icons are cached; default `~/.kedalion/toast-icons`. */
  iconDir?: string;
  /** Receives every toast instead of the Windows toaster (tests). */
  sink?: (toast: Toast) => void;
  toaster?: Toaster;
}

export interface Notification {
  title?: string;
  body: string;
  /** App path the click opens, resolved with `link`. */
  path?: string;
  /** Raw URI for the click; wins over `path`. */
  launch?: string;
}

export interface Notifier {
  (n: Notification): Promise<void>;
}

/** One notification the app was asked to show, kept for the Dashboard's notification log. */
export interface NotificationEntry {
  id: number;
  /** Epoch ms. */
  time: number;
  /** View id or icon name the notification was sent for. */
  view: string;
  title: string;
  body: string;
  path?: string;
  /** True when do not disturb swallowed it (no toast shown). */
  muted: boolean;
}

const MAX_HISTORY = 200;

export interface Notifications {
  /** A `notify` that shows the icon file of a view (by id, `VIEW_ICON_SVGS`) or the given icon name. */
  for(view: string | { icon: string }): Notifier;
  /** The last notifications, newest first (kept in memory, up to 200). */
  history(): NotificationEntry[];
  /** Ends the Windows toast host. */
  close(): Promise<number | null>;
}

/** The app's one notifier: owns the single toaster, resolves click links and the per-view icon PNG. */
export function createNotifications(opts: NotificationsOptions): Notifications {
  const toaster = opts.sink || opts.toaster ? opts.toaster : createToaster();
  const dir = opts.iconDir ?? join(homedir(), '.kedalion', 'toast-icons');
  const send = opts.sink ?? ((toast: Toast) => toaster?.show(toast));
  const log: NotificationEntry[] = [];
  let nextId = 1;
  return {
    history: () => [...log],
    for(view) {
      const svg = typeof view === 'string' ? VIEW_ICON_SVGS[view] : undefined;
      const name = typeof view === 'string' ? view : view.icon;
      return async (n) => {
        const muted = Boolean(await opts.dnd?.());
        log.unshift({ id: nextId++, time: Date.now(), view: name, title: n.title ?? opts.appName, body: n.body, ...(n.path !== undefined && { path: n.path }), muted });
        if (log.length > MAX_HISTORY) log.length = MAX_HISTORY;
        if (muted) return;
        const link = opts.link();
        const launch = n.launch ?? (n.path !== undefined && link ? link(n.path) : '');
        const icon = name ? await iconPng({ name, ...(svg ? { svg } : {}), color: opts.color ?? DEFAULT_ICON_COLOR, dir }) : undefined;
        send({ title: n.title ?? opts.appName, body: n.body, launch, ...(icon ? { icon } : {}) });
      };
    },
    close: async () => (await toaster?.close()) ?? null,
  };
}
