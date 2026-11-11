import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { invalid, notFound } from '@kedalion/server-core';
import { detectAccounts } from '../accounts.ts';
import { findSessionFile } from '../chat/normalize.ts';
import { projectKey } from '../projects.ts';
import type { PanelCtx, PanelRoutes } from './ctx.ts';

/** `planning`: plan-mode session running; `planned`: its plan is captured; then `approved` (implementing session starting), `implementing`, `done`. */
export type TaskState = 'planning' | 'planned' | 'approved' | 'implementing' | 'done';

export interface TaskItem {
  id: string;
  text: string;
  state: TaskState;
  /** The plan-mode Claude session. */
  planSession: string;
  /** The captured plan (markdown). */
  plan?: string;
  /** The acceptEdits session that implements it. */
  implSession?: string;
  /** The implementing session was seen working (it is `done` when it later stops working). */
  worked?: boolean;
  /** Open the Review panel when the task is done. */
  review?: boolean;
  createdAt: number;
}

/** The latest plan a transcript shows: the `ExitPlanMode` input; `answered` when a tool result followed (approved or rejected). */
export interface CapturedPlan {
  plan: string;
  answered: boolean;
}

const STATES: readonly string[] = ['planning', 'planned', 'approved', 'implementing', 'done'];
const MAX_TASKS = 200;
const MAX_TEXT = 100_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The newest `ExitPlanMode` call of a session jsonl. Claude writes the assistant message with the call before it asks the user,
 * so the plan is there while the approval prompt is still open. `input.plan` is used; else the plan file named by `input.planFilePath`
 * (read through `readFile`). Null when the session has no such call yet.
 */
export function capturePlan(jsonl: string, readFile: (path: string) => string | undefined = () => undefined): CapturedPlan | null {
  let found: { id: string; plan: string; index: number } | undefined;
  const answered = new Set<string>();
  let n = 0;
  for (const line of jsonl.split('\n')) {
    n++;
    if (!line.includes('ExitPlanMode') && !line.includes('tool_result')) continue;
    let e: { message?: { content?: unknown } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') answered.add(b.tool_use_id);
      if (b?.type !== 'tool_use' || b.name !== 'ExitPlanMode' || typeof b.id !== 'string' || !isObject(b.input)) continue;
      const input = b.input;
      const plan = typeof input.plan === 'string' && input.plan.trim() ? input.plan : typeof input.planFilePath === 'string' ? readFile(input.planFilePath) : undefined;
      if (plan?.trim()) found = { id: b.id, plan, index: n };
    }
  }
  return found ? { plan: found.plan, answered: answered.has(found.id) } : null;
}

/** Whether `raw` is a task list the panel can save. */
export function isTaskList(raw: unknown): raw is TaskItem[] {
  if (!Array.isArray(raw) || raw.length > MAX_TASKS) return false;
  return raw.every(
    (t) =>
      isObject(t) &&
      typeof t.id === 'string' &&
      t.id.length > 0 &&
      t.id.length <= 64 &&
      typeof t.text === 'string' &&
      t.text.length <= MAX_TEXT &&
      typeof t.state === 'string' &&
      STATES.includes(t.state) &&
      typeof t.planSession === 'string' &&
      (t.plan === undefined || (typeof t.plan === 'string' && t.plan.length <= MAX_TEXT)) &&
      (t.implSession === undefined || typeof t.implSession === 'string') &&
      (t.worked === undefined || typeof t.worked === 'boolean') &&
      (t.review === undefined || typeof t.review === 'boolean') &&
      typeof t.createdAt === 'number',
  );
}

export interface TaskStore {
  fileOf(project: string): string;
  read(project: string): Promise<TaskItem[]>;
  /** Saves the list; false when it is not a task list. */
  write(project: string, tasks: unknown): Promise<boolean>;
}

/** One task file per project in `dir`: `<sha1 of the project path>.json`. */
export function createTaskStore(dir: string): TaskStore {
  const fileOf = (project: string) => join(dir, `${createHash('sha1').update(projectKey(project)).digest('hex')}.json`);
  const accept = (v: unknown) => isObject(v) && isTaskList(v.tasks);
  return {
    fileOf,
    async read(project) {
      if (!project) return [];
      const raw = (await readJsonFile(fileOf(project), accept).catch(() => undefined)) as { tasks: TaskItem[] } | undefined;
      return raw?.tasks ?? [];
    },
    async write(project, tasks) {
      if (!project || !isTaskList(tasks)) return false;
      await writeJsonAtomic(fileOf(project), { version: 1, project, tasks });
      return true;
    },
  };
}

const isUnder = (path: string, roots: string[]): boolean =>
  roots.some((root) => {
    const rel = relative(resolve(root), resolve(path));
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  });

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Server routes of the task panel: the task list per project and the plan a session has captured. */
export const routes: PanelRoutes = (ctx: PanelCtx) => {
  const store = createTaskStore(join(ctx.agentsDir, 'tasks'));
  const rootOf = (project: unknown) => {
    const root = typeof project === 'string' && project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return root;
  };
  return {
    'GET /api/agents/task/list': async ({ query }) => ({ tasks: await store.read(rootOf(query.get('project'))) }),
    'PUT /api/agents/task/list': async ({ query, json }) => {
      const b = await json<{ tasks?: unknown }>();
      if (!(await store.write(rootOf(query.get('project')), b.tasks))) throw invalid('tasks', 'Not a task list');
      return { ok: true };
    },
    // The newest ExitPlanMode plan of a session (read on demand); `plan: null` until Claude finishes planning.
    'GET /api/agents/task/plan': ({ query }) => {
      const id = query.get('sessionId') ?? '';
      for (const a of detectAccounts(homedir())) {
        const file = findSessionFile(a.dir, id);
        if (!file) continue;
        const text = readText(file);
        const roots = [...detectAccounts(homedir()).map((x) => join(x.dir, 'plans')), ...ctx.projects().map((p) => p.path)];
        const found = text === undefined ? null : capturePlan(text, (p) => (isUnder(p, roots) ? readText(p) : undefined));
        return { plan: found?.plan ?? null, answered: found?.answered ?? false };
      }
      return { plan: null, answered: false };
    },
  };
};
