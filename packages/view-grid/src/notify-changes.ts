import type { SourceContext } from './server';

const MAX_LINES = 3;
/** Most scopes remembered; old configs of edited panels fall out. */
const MAX_SCOPES = 200;

const seen = new Map<string, Map<string, string>>();

export interface NotifyChangesOptions<T> {
  /** Stable identity of an item. */
  key(item: T): string;
  /** Changes when the item changed in a way worth a toast; a constant notifies only new items. */
  sig(item: T): string;
  title: string;
  /** One line of the toast per new or changed item. */
  line(item: T): string;
  /**
   * Splits the toast by heading: one toast per distinct heading, titled `<title> - <heading>`.
   * `isNew` is true for an item that was not in the previous call.
   */
  heading?(item: T, isNew: boolean): string;
  /**
   * Replaces `heading` and `line` when set: the toast lines of one changed item, each with its
   * heading. `prevSig` is the item's `sig` in the previous call, undefined for a new item.
   */
  events?(item: T, prevSig: string | undefined): { heading: string; line: string }[];
}

/** One toast per heading (titled `<title> - <heading>`), each with up to 3 lines and `and N more`. */
export function notifyLines(notify: NonNullable<SourceContext['notify']>, title: string, events: readonly { heading: string; line: string }[]): void {
  const groups = new Map<string, string[]>();
  for (const e of events) groups.set(e.heading, [...(groups.get(e.heading) ?? []), e.line]);
  for (const [h, all] of groups) {
    const lines = all.slice(0, MAX_LINES);
    if (all.length > MAX_LINES) lines.push(`and ${all.length - MAX_LINES} more`);
    notify({ title: h ? `${title} - ${h}` : title, body: lines.join('\n') }).catch(() => {});
  }
}

/**
 * Toasts the items that are new or whose `sig` changed since the last call with the same `scope`
 * (one toast per call). The first call of a scope only records the items. `scope` should hold the
 * source id and the config, so two panels with different settings do not share state.
 */
export function notifyChanges<T>(ctx: Pick<SourceContext, 'notify'>, scope: string, items: readonly T[], o: NotifyChangesOptions<T>): void {
  const next = new Map(items.map((i) => [o.key(i), o.sig(i)] as const));
  const prev = seen.get(scope);
  // Re-insert so the Map order is least recently used first, then drop the oldest scopes past the cap.
  seen.delete(scope);
  seen.set(scope, next);
  while (seen.size > MAX_SCOPES) seen.delete(seen.keys().next().value!);
  if (!prev || !ctx.notify) return;
  const changed = items.filter((i) => prev.get(o.key(i)) !== next.get(o.key(i)));
  if (changed.length === 0) return;
  notifyLines(
    ctx.notify,
    o.title,
    changed.flatMap((i) =>
      o.events ? o.events(i, prev.get(o.key(i))) : [{ heading: o.heading ? o.heading(i, !prev.has(o.key(i))) : '', line: o.line(i) }],
    ),
  );
}

/** `scope` for a source id and its config: the same settings always give the same string. */
export const notifyScope = (sourceId: string, config: Record<string, unknown>): string =>
  `${sourceId}:${JSON.stringify(Object.keys(config).sort().map((k) => [k, config[k]]))}`;

export const resetNotifyChanges = (): void => seen.clear();
