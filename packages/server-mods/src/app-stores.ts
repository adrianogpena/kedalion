import { statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { appHome, secretStore } from '@kedalion/platform';
import { AppError, invalid, isRecord, notFound, type Routes } from '@kedalion/server-core';
import { TICKETS_PROJECT_ID, REST_ENV_MAX_VARS, REST_ENV_NAME_CHARS, REST_VAR_NAME, type HttpRequestDraft, type RestChainStep, type RestEnvVar } from '@kedalion/server-core/protocol';
import { httpExecutor, httpRoutes, validateDraft } from './http.ts';
import { pickedPaths } from './dialogs.ts';
import type { DialogPicks } from './file-dialog.ts';
import { uiBroker, type UiBroker } from './ui-broker.ts';
import { recordRoutes, recordStore, type RecordStore } from './records.ts';
import { restHistory, type RestHistory } from './rest-history.ts';

export interface SavedRequest {
  name: string;
  request: HttpRequestDraft;
  /** Value of the Authorization header; kept in the secret store, never returned by a route. */
  auth?: unknown;
}

export interface StoredEnvironment {
  name: string;
  /** A secret variable's value is `''` here; `set` tells whether `secrets` holds one. */
  vars: RestEnvVar[];
  /** JSON object name → value of the secret variables; a secret field. */
  secrets?: unknown;
}

export interface StoredChain {
  name: string;
  steps: RestChainStep[];
}

export interface AppStoresOptions {
  /** The app data folder; defaults to `appHome(appId)`. */
  home?: string;
  secrets?: ReturnType<typeof secretStore>;
  /** Initial size of the REST history (the app updates it with `restHistory.setMax`). */
  restHistoryMax?: number;
}

/** The stores the explorer, git and rest views (and the shared http routes) read from `ctx.stores`. */
export interface AppStores {
  home: string;
  secrets: ReturnType<typeof secretStore>;
  pickedFolders: ReturnType<typeof pickedPaths>;
  /** The in-app file dialog's picks: `opened` is `pickedFolders`. */
  picks: DialogPicks;
  /** Asks the open page questions (confirm dialogs) over a socket. */
  ui: UiBroker;
  projects: RecordStore<{ name: string; path: string }>;
  projectRoots: () => Promise<Array<{ id: string; path: string }>>;
  requests: RecordStore<SavedRequest>;
  restHistory: RestHistory;
  /** Saved REST chains (steps of saved requests with captures). */
  chains: RecordStore<StoredChain>;
  environments: RecordStore<StoredEnvironment>;
  /** Client input as the environments store takes it (secret variables go to the secret store). */
  environmentInput: (raw: unknown, id?: string) => Promise<unknown>;
  /** The enabled variables of an environment, secrets included. */
  environmentVars: (id: string) => Promise<Record<string, string>>;
  /** Names of the secret variables of an environment. */
  secretVars: (id: string) => Promise<string[]>;
  /** The saved Authorization value, only for the origin the request was saved with. */
  secretHeaders: (ref: string, url: string, resolve: (text: string) => string) => Promise<Array<[string, string]>>;
}

export { TICKETS_PROJECT_ID };
/** Folder of the default tickets root under the app home. */
export const TICKETS_DIR = 'tickets';
const MAX_VAR_VALUE_CHARS = 8192;
const badEnvironment = () => invalid('badEnvironment', 'The environment is not valid.');

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** Builds the stores of the packaged views for app `appId`; spread the result into `mountViews` `stores`. */
export function appStores(appId: string, opts: AppStoresOptions = {}): AppStores {
  const home = opts.home ?? appHome(appId);
  const secrets = opts.secrets ?? secretStore(appId);

  /** Folders the folder dialog returned; a project path must be one of them (taken once). */
  const pickedFolders = pickedPaths();

  /** The folders the Explorer screen shows; each is a root of the rooted file system. */
  const projects = recordStore<{ name: string; path: string }>({
    dir: home,
    name: 'projects',
    validate(input, prev, ctx) {
      const { name, path } = (input ?? {}) as { name?: unknown; path?: unknown };
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badProjectName', 'The name must have 1 to 80 characters.');
      // An unchanged path skips the stat: it would block the server while a share is offline.
      if (typeof path === 'string' && path === prev?.path) return { name: trimmed, path };
      // A backup's path was not picked here, but the user picked the backup file in a dialog.
      if (typeof path !== 'string' || !(ctx?.imported || pickedFolders.take(path))) throw invalid('pickFolderFirst', 'Choose the folder with Browse.');
      if (!isAbsolute(path) || !isDirectory(path)) throw invalid('badProjectPath', 'The path must be an existing folder.');
      return { name: trimmed, path };
    },
  });

  const ticketsRoot = join(home, TICKETS_DIR);
  const projectRoots = async () => {
    const list = (await projects.list()).map((p) => ({ id: p.id, path: p.path }));
    const target = resolve(ticketsRoot);
    const covered = list.some((p) => {
      const rel = relative(resolve(p.path), target);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
    return covered ? list : [...list, { id: TICKETS_PROJECT_ID, path: ticketsRoot }];
  };

  /** Saved REST requests; the Authorization value is a secret field. */
  const requests = recordStore<SavedRequest>({
    dir: home,
    name: 'requests',
    secretFields: ['auth'],
    secrets,
    validate(input) {
      const { name, request } = isRecord(input) ? input : ({} as Record<string, unknown>);
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badRequestName', 'The name must have 1 to 80 characters.');
      return { name: trimmed, request: validateDraft(request) };
    },
  });

  /** Sent REST requests. */
  const history = restHistory({ dir: home, max: opts.restHistoryMax ?? 100 });

  /** REST environments for `{{name}}`; secret values live in the secret store, the client sees only `set`. */
  const environments = recordStore<StoredEnvironment>({
    dir: home,
    name: 'environments',
    secretFields: ['secrets'],
    secrets,
    validate(input, prev, ctx) {
      const { name, vars } = isRecord(input) ? input : ({} as Record<string, unknown>);
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed.length < 1 || trimmed.length > REST_ENV_NAME_CHARS) throw invalid('badEnvironmentName', 'The name must have 1 to 80 characters.');
      if (!Array.isArray(vars) || vars.length > REST_ENV_MAX_VARS) throw badEnvironment();
      const names = new Set<string>();
      const out = vars.map((v): RestEnvVar => {
        if (!isRecord(v) || typeof v.name !== 'string' || typeof v.value !== 'string' || typeof v.secret !== 'boolean') throw badEnvironment();
        if (!REST_VAR_NAME.test(v.name)) throw invalid('badVariableName', 'A variable name may have letters, digits, _ . and -, and starts with a letter or _.');
        if (names.has(v.name)) throw invalid('duplicateVariable', 'Two variables have the same name.');
        names.add(v.name);
        const enabled = v.enabled !== false;
        if (!v.secret) {
          if (v.value.length > MAX_VAR_VALUE_CHARS) throw badEnvironment();
          return { name: v.name, value: v.value, secret: false, enabled };
        }
        // An import never carries secrets: a variable is set only when the stored record had it set.
        const set = ctx?.imported ? Boolean(prev?.vars.find((p) => p.name === v.name && p.secret)?.set) : v.set === true;
        return { name: v.name, value: '', secret: true, enabled, set };
      });
      return { name: trimmed, vars: out };
    },
  });

  const badChain = () => invalid('badChain', 'The chain is not valid.');
  const chains = recordStore<StoredChain>({
    dir: home,
    name: 'rest-chains',
    validate(input) {
      const { name, steps } = isRecord(input) ? input : ({} as Record<string, unknown>);
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed.length < 1 || trimmed.length > 80) throw invalid('badChainName', 'The name must have 1 to 80 characters.');
      if (!Array.isArray(steps) || steps.length > 50) throw badChain();
      const out = steps.map((s): RestChainStep => {
        if (!isRecord(s) || typeof s.requestId !== 'string' || s.requestId === '') throw badChain();
        const caps = s.captures ?? [];
        if (!Array.isArray(caps) || caps.length > 20) throw badChain();
        return {
          requestId: s.requestId,
          captures: caps.map((c) => {
            if (!isRecord(c) || typeof c.name !== 'string' || !/^[A-Za-z_][\w.-]{0,63}$/.test(c.name)) throw badChain();
            if ((c.from !== 'body' && c.from !== 'header') || typeof c.path !== 'string' || c.path.length > 200) throw badChain();
            return { name: c.name, from: c.from, path: c.path };
          }),
        };
      });
      return { name: trimmed, steps: out };
    },
  });

  const storedSecrets = async (id: string): Promise<Map<string, string>> => {
    const raw = await environments.secret(id, 'secrets');
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    return new Map(isRecord(parsed) ? Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string') : []);
  };

  /**
   * Client input as the store takes it: a secret variable with a string `value` sets or replaces it
   * (`''` clears it), without one it keeps the stored value of `from` (old name) or its own name.
   */
  const environmentInput = async (raw: unknown, id?: string): Promise<unknown> => {
    if (!isRecord(raw) || !Array.isArray(raw.vars) || raw.vars.length > REST_ENV_MAX_VARS) throw badEnvironment();
    const old = id ? await storedSecrets(id) : new Map<string, string>();
    const kept: Record<string, string> = {};
    const vars = raw.vars.map((v) => {
      if (!isRecord(v) || v.secret !== true || typeof v.name !== 'string') return v;
      const value = typeof v.value === 'string' ? v.value : (old.get(typeof v.from === 'string' ? v.from : v.name) ?? '');
      if (value.length > MAX_VAR_VALUE_CHARS) throw badEnvironment();
      if (value !== '') kept[v.name] = value;
      return { name: v.name, value: '', secret: true, enabled: v.enabled, set: value !== '' };
    });
    return { name: raw.name, vars, secrets: Object.keys(kept).length ? JSON.stringify(kept) : '' };
  };

  /** The enabled variables of environment `id`, secrets included; a secret without a value is left out (unknown). */
  const environmentVars = async (id: string): Promise<Record<string, string>> => {
    const env = await environments.get(id).catch((err: unknown) => {
      if (err instanceof AppError && err.kind === 'notfound') throw notFound('environmentNotFound', 'The environment no longer exists.');
      throw err;
    });
    const stored = env.vars.some((v) => v.secret && v.enabled) ? await storedSecrets(id) : new Map<string, string>();
    const vars: Record<string, string> = {};
    for (const v of env.vars) {
      if (!v.enabled) continue;
      const value = v.secret ? stored.get(v.name) : v.value;
      if (value !== undefined) vars[v.name] = value;
    }
    return vars;
  };

  const secretVars = async (id: string): Promise<string[]> => {
    const env = await environments.get(id).catch(() => null);
    return env ? env.vars.filter((v) => v.secret).map((v) => v.name) : [];
  };

  /**
   * The saved Authorization value, only for the origin the request was saved with. Both URLs are
   * compared resolved (the saved one with the same environment): the check is against the URL sent.
   */
  const secretHeaders = async (ref: string, url: string, resolve: (text: string) => string): Promise<Array<[string, string]>> => {
    const saved = await requests.get(ref).catch((err: unknown) => {
      if (err instanceof AppError && err.kind === 'notfound') return null;
      throw err;
    });
    if (!saved || !sameOrigin(url, resolve(saved.request.url))) return [];
    const value = await requests.secret(ref, 'auth');
    return value ? [['Authorization', value]] : [];
  };

  const picks: DialogPicks = { opened: pickedFolders, saveTargets: pickedPaths() };
  const ui = uiBroker();

  return { home, secrets, pickedFolders, picks, ui, projects, projectRoots, requests, restHistory: history, chains, environments, environmentInput, environmentVars, secretVars, secretHeaders };
}

/** `/api/http/*` (send, import, save...): shared by the rest view and the Explorer curl panel, so both declare it as `shared: 'http'`. */
export const httpSharedRoutes = (stores: Pick<AppStores, 'secretHeaders' | 'environmentVars' | 'secretVars' | 'restHistory' | 'picks'>): Routes =>
  httpRoutes(httpExecutor(), {
    picks: stores.picks,
    secretHeaders: stores.secretHeaders,
    environmentVars: stores.environmentVars,
    secretVars: stores.secretVars,
    onSend: (entry) => stores.restHistory.append(entry),
  });

/** `/api/rest/environments` CRUD with secret-aware create and update. */
export function environmentRoutes(stores: Pick<AppStores, 'environments' | 'environmentInput'>): Routes {
  const { environments, environmentInput } = stores;
  return {
    ...recordRoutes(environments, '/api/rest/environments'),
    'POST /api/rest/environments': async ({ json }) => environments.create(await environmentInput(await json())),
    'PUT /api/rest/environments': async ({ query, json }) => {
      const id = query.get('id');
      if (!id) throw invalid('badRequest', 'Invalid request.');
      return environments.update(id, await environmentInput(await json(), id));
    },
  };
}
