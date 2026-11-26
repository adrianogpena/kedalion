import { defineSource, type DataSource, type GridPanelSpec, type SourceContext } from '../../server';
import { TODO_FIELDS } from './fields';
import { addTask, closeTask, deleteTask, listTasks, reopenTask, renameTask } from './todoist';
import { createJsonStore } from '../../json-store';
import { addSnippet, addTodo, clearDone, editTodo, emptyDaily, parseDaily, removeSnippet, removeTodo, setScratch, toggleTodo, type Daily } from './model';

const stores = new Map<string, ReturnType<typeof createJsonStore<Daily>>>();

const storeOf = (dataDir: string) => {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore<Daily>({ dataDir, name: 'daily', parse: parseDaily, empty: emptyDaily });
    stores.set(dataDir, s);
  }
  return s;
};

const field = (payload: unknown, key: string): string => {
  const v = ((payload ?? {}) as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};

const edit = (dataDir: string, fn: (d: Daily) => Daily) => storeOf(dataDir).update(fn);

const dailySource = (id: string, actions: DataSource['actions']): DataSource =>
  defineSource({ id, fields: [], fetch: (_config, ctx) => storeOf(ctx.dataDir).read(), actions });

type TodoConfig = {
  filter: string;
};

/** The Todoist credentials when a Todoist connection exists; undefined means the local list. */
const remoteOf = async (_config: TodoConfig, ctx: SourceContext) => {
  try {
    return await ctx.connection('todoist');
  } catch (err) {
    if ((err as { code?: string }).code === 'source-not-configured') return undefined;
    throw err;
  }
};

export const todoSource = defineSource<TodoConfig>({
  id: 'todo',
  fields: TODO_FIELDS,
  async fetch(config, ctx) {
    const conn = await remoteOf(config, ctx);
    if (!conn) return storeOf(ctx.dataDir).read();
    return { ...emptyDaily(), todos: await listTasks(conn, config.filter.trim(), ctx.signal), remote: true };
  },
  actions: {
    add: async (p, c, ctx) => {
      const conn = await remoteOf(c, ctx);
      const text = field(p, 'text');
      if (!conn) return edit(ctx.dataDir, (d) => addTodo(d, crypto.randomUUID(), text));
      if (text.trim()) await addTask(conn, text, c.filter);
    },
    toggle: async (p, c, ctx) => {
      const conn = await remoteOf(c, ctx);
      if (!conn) return edit(ctx.dataDir, (d) => toggleTodo(d, field(p, 'id')));
      await closeTask(conn, field(p, 'id'));
    },
    reopen: async (p, c, ctx) => {
      const conn = await remoteOf(c, ctx);
      if (conn) await reopenTask(conn, field(p, 'id'));
    },
    edit: async (p, c, ctx) => {
      const conn = await remoteOf(c, ctx);
      if (!conn) return edit(ctx.dataDir, (d) => editTodo(d, field(p, 'id'), field(p, 'text')));
      if (field(p, 'text').trim()) await renameTask(conn, field(p, 'id'), field(p, 'text'));
    },
    remove: async (p, c, ctx) => {
      const conn = await remoteOf(c, ctx);
      if (!conn) return edit(ctx.dataDir, (d) => removeTodo(d, field(p, 'id')));
      await deleteTask(conn, field(p, 'id'));
    },
    'clear-done': async (_p, c, ctx) => ((await remoteOf(c, ctx)) ? undefined : edit(ctx.dataDir, clearDone)),
  },
});

export const scratchpadSource = dailySource('scratchpad', {
  save: (p, _c, ctx) => edit(ctx.dataDir, (d) => setScratch(d, field(p, 'text'))),
});

export const snippetsSource = dailySource('snippets', {
  add: (p, _c, ctx) => edit(ctx.dataDir, (d) => addSnippet(d, crypto.randomUUID(), field(p, 'label'), field(p, 'text'))),
  remove: (p, _c, ctx) => edit(ctx.dataDir, (d) => removeSnippet(d, field(p, 'id'))),
});

export const specs: GridPanelSpec[] = [
  { kind: 'todo', fields: TODO_FIELDS, allowMultiple: false },
  { kind: 'scratchpad', fields: [], allowMultiple: false },
  { kind: 'snippets', fields: [], allowMultiple: false },
  { kind: 'focus-timer', fields: [], allowMultiple: false },
];

export const sources: DataSource<any>[] = [todoSource, scratchpadSource, snippetsSource];
