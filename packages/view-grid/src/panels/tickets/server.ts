import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { invalid } from '@kedalion/server-core';
import { createJsonStore, type JsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec, type SourceContext } from '../../server';
import { fieldIds, search, searchKeys } from '../jira/client';
import { fetchPrExtra, fetchPrItem, fetchPrPool, trackedStore } from '../github/server';
import type { TrackedPr } from '../github/tracked';
import { latestPods } from '../pods/server';
import { TICKETS_FIELDS } from './fields';
import { notifyChanges, notifyScope } from '../../notify-changes';
import { planAutoMoves } from './auto-move';
import { infoFields, mapInfo, pcrOf, ticketEvents, type JiraInfo } from './jira-info';
import { linkTickets } from './linker';
import type { NoteTemplate } from './note-templates';
import { add, extractKey, MAX_TICKETS, move, normPodId, parsePcr, parseStatuses, remove, update, type Ticket } from './model';
import type { TicketsData } from './types';

interface TicketsConfig {
  connection: string;
  jiraConnection?: string;
  statuses: string;
  keyPattern: string;
  jiraBaseUrl: string;
  autoMove?: boolean;
  readyLabel?: string;
  notify?: boolean;
  notesFolder?: string;
  [key: string]: unknown;
}

interface TicketStore {
  tickets: Ticket[];
  /** Auto-move rules seen per ticket key at the last fetch. */
  autoMoveMemory: Record<string, string[]>;
}

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

function prRef(payload: unknown): { repo: string; number: number } {
  const p = (payload ?? {}) as { repo?: unknown; number?: unknown };
  const repo = str(p.repo, 200);
  const number = Number(p.number);
  if (!/^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/.test(repo) ||!Number.isInteger(number) || number <= 0) throw invalid('pr-ref', 'A pull request is required.');
  return { repo, number };
}

const MAX_NOTES = 200_000;
const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

/** The linked notes folder, '' when none; it must lie inside an Explorer project. */
async function notesFolderOf(config: { notesFolder?: string }, ctx: SourceContext): Promise<string> {
  const folder = (config.notesFolder ?? '').trim();
  if (!folder) return '';
  if (!(await insideRoots(folder, ctx))) throw invalid('ticket-notes-folder', 'The notes folder is not inside an Explorer project.', { folder });
  return folder;
}

/** The real path of p, or of its nearest existing ancestor with the rest appended. */
async function realOrNearest(p: string): Promise<string> {
  let cur = resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await realpath(cur), ...rest);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}

/** Whether p, symlinks resolved, lies inside an Explorer project root. */
async function insideRoots(p: string, ctx: SourceContext): Promise<boolean> {
  const roots = (await ctx.projectRoots?.()) ?? [];
  const target = await realOrNearest(p);
  for (const r of roots) {
    const rel = relative(await realOrNearest(r.path), target);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return true;
  }
  return false;
}

/** Refuses a notes file that is a symlink pointing outside every Explorer project (or dangling). */
async function assertNotesFile(file: string, ctx: SourceContext): Promise<void> {
  let link = false;
  try {
    link = (await lstat(file)).isSymbolicLink();
  } catch {
    return;
  }
  if (!link) return;
  let target = '';
  try {
    target = await realpath(file);
  } catch {
    /* dangling link */
  }
  if (!target || !(await insideRoots(target, ctx))) throw invalid('ticket-notes-link', 'The notes file links outside the Explorer projects.', { file });
}

/** The notes file of a ticket key in the linked folder, or null for an unsafe key. */
const notesFile = (folder: string, key: string): string | null => (SAFE_KEY.test(key) ? join(folder, `${key}.md`) : null);

function parseStore(raw: unknown): TicketStore {
  const list = (raw as { tickets?: unknown })?.tickets;
  const tickets: Ticket[] = [];
  if (Array.isArray(list)) {
    for (const r of list.slice(0, MAX_TICKETS)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const key = str(o.key, 100);
      if (!str(o.id, 100) || !key) continue;
      const t: Ticket = {
        id: str(o.id, 100),
        key,
        description: str(o.description),
        status: str(o.status, 200),
        autoMove: typeof o.autoMove === 'boolean' ? o.autoMove : null,
        order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : tickets.length,
      };
      if (Array.isArray(o.podLinks)) t.podLinks = o.podLinks.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 500)).slice(0, 50);
      if (Array.isArray(o.aliases)) t.aliases = o.aliases.filter((x): x is string => typeof x === 'string' && !!x).map((x) => x.slice(0, 100)).slice(0, 50);
      if (parsePcr(str(o.pcr, 20))) t.pcr = parsePcr(str(o.pcr, 20));
      if (typeof o.notes === 'string' && o.notes) t.notes = str(o.notes, MAX_NOTES);
      if (typeof o.movedAt === 'number') t.movedAt = o.movedAt;
      if (typeof o.autoMovedAt === 'number') t.autoMovedAt = o.autoMovedAt;
      if (typeof o.jiraMuted === 'string' && o.jiraMuted) t.jiraMuted = str(o.jiraMuted, 200);
      tickets.push(t);
    }
  }
  const autoMoveMemory: Record<string, string[]> = {};
  const mem = (raw as { autoMoveMemory?: unknown })?.autoMoveMemory;
  if (mem && typeof mem === 'object') {
    for (const [k, v] of Object.entries(mem as Record<string, unknown>)) {
      if (Array.isArray(v)) autoMoveMemory[k.slice(0, 100)] = v.filter((x): x is string => typeof x === 'string').slice(0, 10);
    }
  }
  return { tickets, autoMoveMemory };
}

const stores = new Map<string, JsonStore<TicketStore>>();
/** The `tickets` store of a data dir. */
export function ticketsStore(dataDir: string): JsonStore<TicketStore> {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'tickets', parse: parseStore, empty: () => ({ tickets: [], autoMoveMemory: {} }) });
    stores.set(dataDir, s);
  }
  return s;
}

const MAX_TEMPLATES = 50;

/** The starting templates; `{{key}}`, `{{title}}` and `{{url}}` are filled in when one is applied. */
const DEFAULT_TEMPLATES: NoteTemplate[] = [
  {
    id: 'task',
    name: 'Task',
    body: [
      '---', 'id: {{key}}', 'title: {{title}}', 'url: {{url}}', '---', 'feature/DIPE/{{key}}', '',
      '## Releases', '', '## Always good to remember', '',
      '- Final test local', '- Local Unit Test Validation', "- @dba I've merged the code to Master. Please merge the scripts.", '',
      '## Links', '', '## Notes', '',
    ].join('\n'),
  },
  {
    id: 'task-mmp',
    name: 'Task MMP',
    body: [
      '---', 'id: {{key}}', 'title: {{title}}', 'url: {{url}}', '---', 'feature/DIPE/{{key}}', '',
      '## Services changed', '', '## Always good to remember', '',
      '- Final test local', '- ALWAYS RUN ALL LOCAL TESTS BEFORE PUSH', '- Update parent framework (./mvnw versions:update-parent)',
      '- Check if kustomization is ok', '- Use ingress to get URL for test service', '', '- Create SofHistory (npx changeset)', '', '## Notes', '',
    ].join('\n'),
  },
];

function parseTemplates(raw: unknown): { templates: NoteTemplate[] } {
  const list = (raw as { templates?: unknown })?.templates;
  const templates: NoteTemplate[] = [];
  if (Array.isArray(list)) {
    for (const r of list.slice(0, MAX_TEMPLATES)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = str(o.id, 100);
      const name = str(o.name, 100).trim();
      if (id && name) templates.push({ id, name, body: str(o.body, MAX_NOTES) });
    }
  }
  return { templates };
}

const templateStores = new Map<string, JsonStore<{ templates: NoteTemplate[] }>>();
/** The note-templates store of a data dir; starts with the default templates. */
function templatesStore(dataDir: string): JsonStore<{ templates: NoteTemplate[] }> {
  let s = templateStores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'ticket-note-templates', parse: parseTemplates, empty: () => ({ templates: DEFAULT_TEMPLATES }) });
    templateStores.set(dataDir, s);
  }
  return s;
}

/** A deterministic string of an auto-move memory (keys sorted), to compare two of them. */
const memorySig = (m: Record<string, string[]>): string => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));

const payloadOf = (p: unknown) => (p ?? {}) as Record<string, unknown>;

export const ticketsSource = defineSource<TicketsConfig>({
  id: 'tickets',
  fields: TICKETS_FIELDS,
  async fetch(config, ctx): Promise<TicketsData> {
    const store = ticketsStore(ctx.dataDir);
    const stored = await store.read();
    let { tickets } = stored;
    let prError = false;
    let jiraError = false;
    const loadPrs = async (): Promise<TrackedPr[]> => {
      if (!config.connection) return [];
      try {
        const conn = await ctx.connection(config.connection, 'github');
        const { refs } = await trackedStore(ctx.dataDir).read();
        return await fetchPrPool(conn, { tracked: refs, keys: tickets.flatMap((t) => [t.key, ...(t.aliases ?? [])]), signal: ctx.signal });
      } catch {
        prError = true;
        return [];
      }
    };
    const loadJira = async (): Promise<Record<string, JiraInfo>> => {
      const jira: Record<string, JiraInfo> = {};
      if (config.jiraConnection && tickets.length) {
        try {
          const conn = await ctx.connection(config.jiraConnection, 'jira');
          const keys = tickets.map((t) => t.key).filter((k) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(k));
          const pointsId = (await fieldIds(conn, ctx.signal)).points;
          const raw = keys.length ? await searchKeys(conn, keys, infoFields(pointsId), ctx.signal) : [];
          for (const r of raw) jira[String(r.key)] = mapInfo(r, pointsId);
        } catch {
          jiraError = true;
        }
      }
      return jira;
    };
    const [prs, jira] = await Promise.all([loadPrs(), loadJira()]);
    if (config.notify !== false && config.jiraConnection && !jiraError) {
      notifyChanges(
        ctx,
        notifyScope('tickets', config),
        tickets.filter((t) => jira[t.key]),
        {
          key: (t) => t.key,
          sig: (t) => JSON.stringify([jira[t.key]!.status, jira[t.key]!.assignee, jira[t.key]!.priority]),
          title: 'Tickets',
          line: (t) => `${t.key}: ${jira[t.key]!.status}`,
          events: (t, prevSig) => ticketEvents(t.key, prevSig, jira[t.key]!),
        },
      );
    }
    const pods = latestPods();
    const { links, unlinked } = linkTickets(
      tickets.map((t) => t.key),
      prs,
      pods,
      config.keyPattern,
      Object.fromEntries(tickets.filter((t) => t.podLinks?.length).map((t) => [t.key, t.podLinks!])),
      Object.fromEntries(tickets.filter((t) => t.aliases?.length).map((t) => [t.key, t.aliases!])),
    );
    const statuses = parseStatuses(config.statuses ?? '');
    if (config.connection && !prError) {
      const now = Date.now();
      const ready = config.readyLabel || 'ready to merge';
      const plan0 = planAutoMoves(stored.tickets, links, statuses, stored.autoMoveMemory, config.autoMove !== false, ready);
      if (plan0.moves.length || memorySig(plan0.memory) !== memorySig(stored.autoMoveMemory)) {
        const saved = await store.update((s) => {
          const plan = planAutoMoves(s.tickets, links, statuses, s.autoMoveMemory, config.autoMove !== false, ready);
          let list = s.tickets;
          for (const m of plan.moves) {
            list = move(list, m.id, m.status, Number.MAX_SAFE_INTEGER, now).map((t) => (t.id === m.id ? { ...t, autoMovedAt: now } : t));
          }
          return { tickets: list, autoMoveMemory: plan.memory };
        });
        tickets = saved.tickets;
      }
    }
    return { statuses, tickets, links, unlinked, pods, jira, ...(prError ? { prError } : {}) };
  },
  actions: {
    async pr(payload, config, ctx) {
      const { repo, number } = prRef(payload);
      const item = await fetchPrItem(await ctx.connection(config.connection, 'github'), repo, number, config.keyPattern, ctx.signal);
      if (!item) throw invalid('pr-not-found', 'The pull request was not found.');
      return item;
    },
    async 'pr-extra'(payload, config, ctx) {
      const { repo, number } = prRef(payload);
      return fetchPrExtra(await ctx.connection(config.connection, 'github'), repo, number, ctx.signal);
    },
    async add(payload, config, ctx) {
      const p = payloadOf(payload);
      const key = extractKey(str(p.key, 200), config.keyPattern);
      if (!key) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      const status = parseStatuses(config.statuses ?? '')[0]!;
      const description = str(p.description);
      let pcr = parsePcr(str(p.pcr, 20));
      if (!pcr && config.jiraConnection && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) {
        try {
          const conn = await ctx.connection(config.jiraConnection, 'jira');
          const [raw] = await search(conn, `key = ${key}`, ['summary', 'parent', 'labels', 'issuelinks'], 1, ctx.signal);
          if (raw) pcr = pcrOf(raw);
        } catch {
          // the PCR is optional; it can be typed in the side panel
        }
      }
      const saved = await ticketsStore(ctx.dataDir).update((s) => {
        if (s.tickets.some((t) => t.key === key)) throw invalid('ticket-duplicate', 'The ticket is already on the board.', { key });
        if (s.tickets.length >= MAX_TICKETS) throw invalid('ticket-limit', 'The board is full.');
        return { ...s, tickets: add(s.tickets, key, status, description, undefined, pcr, config.autoMove !== false) };
      });
      return saved.tickets;
    },
    async move(payload, _config, ctx) {
      const p = payloadOf(payload);
      const index = typeof p.index === 'number' && Number.isFinite(p.index) ? Math.trunc(p.index) : 0;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: move(s.tickets, str(p.id, 100), str(p.status, 200), index) }))).tickets;
    },
    async update(payload, _config, ctx) {
      const p = payloadOf(payload);
      const patch: Parameters<typeof update>[2] = {};
      if ('description' in p) patch.description = str(p.description);
      if ('pcr' in p) patch.pcr = parsePcr(str(p.pcr, 20));
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), patch) }))).tickets;
    },
    async 'notes-get'(payload, config, ctx): Promise<string> {
      const p = payloadOf(payload);
      const ticket = (await ticketsStore(ctx.dataDir).read()).tickets.find((t) => t.id === str(p.id, 100));
      if (!ticket) return '';
      const folder = await notesFolderOf(config, ctx);
      const file = folder ? notesFile(folder, ticket.key) : null;
      if (!file) return ticket.notes ?? '';
      await assertNotesFile(file, ctx);
      try {
        return await readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return ticket.notes ?? '';
        throw invalid('ticket-notes-read', 'The notes file could not be read.', { file });
      }
    },
    async 'notes-set'(payload, config, ctx) {
      const p = payloadOf(payload);
      const text = str(p.text, MAX_NOTES);
      const ticket = (await ticketsStore(ctx.dataDir).read()).tickets.find((t) => t.id === str(p.id, 100));
      if (!ticket) return;
      const folder = await notesFolderOf(config, ctx);
      if (!folder) {
        await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, ticket.id, { notes: text }) }));
        return;
      }
      const file = notesFile(folder, ticket.key);
      if (!file) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      await assertNotesFile(file, ctx);
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(file, text, 'utf8');
      } catch {
        throw invalid('ticket-notes-write', 'The notes file could not be saved.', { file });
      }
    },
    async 'templates-get'(_payload, _config, ctx): Promise<NoteTemplate[]> {
      return (await templatesStore(ctx.dataDir).read()).templates;
    },
    async 'templates-set'(payload, _config, ctx): Promise<NoteTemplate[]> {
      const { templates } = parseTemplates({ templates: payloadOf(payload).templates });
      return (await templatesStore(ctx.dataDir).update(() => ({ templates }))).templates;
    },
    async 'link-key'(payload, config, ctx) {
      const p = payloadOf(payload);
      const key = str(p.key, 100).toUpperCase();
      if (!key || (extractKey(key, config.keyPattern) !== key && !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key))) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      return (
        await ticketsStore(ctx.dataDir).update((s) => ({
          ...s,
          tickets: s.tickets.map((t) => {
            if (t.id !== str(p.id, 100) || t.key.toUpperCase() === key || t.aliases?.includes(key)) return t;
            return { ...t, aliases: [...(t.aliases ?? []), key].slice(0, 50) };
          }),
        }))
      ).tickets;
    },
    async 'link-pod'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const pod = normPodId(str(p.pod, 500));
      if (!pod) throw invalid('ticket-invalid-pod', 'Not a pod.');
      const on = p.linked !== false;
      return (
        await ticketsStore(ctx.dataDir).update((s) => ({
          ...s,
          tickets: s.tickets.map((t) => {
            if (t.id !== str(p.id, 100)) return t;
            const rest = (t.podLinks ?? []).filter((x) => normPodId(x) !== pod);
            return { ...t, podLinks: on ? [...rest, pod] : rest };
          }),
        }))
      ).tickets;
    },
    async 'set-auto-move'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const autoMove = typeof p.value === 'boolean' ? p.value : null;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), { autoMove }) }))).tickets;
    },
    async 'set-auto-move-all'(payload, _config, ctx) {
      const autoMove = payloadOf(payload).value === true;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: s.tickets.map((t) => ({ ...t, autoMove })) }))).tickets;
    },
    async 'set-jira-muted'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const jiraMuted = str(p.value, 200) || undefined;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), { jiraMuted }) }))).tickets;
    },
    async remove(payload, _config, ctx) {
      const p = payloadOf(payload);
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: remove(s.tickets, str(p.id, 100)) }))).tickets;
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'tickets', fields: TICKETS_FIELDS, allowMultiple: false }];

export const sources: DataSource<any>[] = [ticketsSource];
