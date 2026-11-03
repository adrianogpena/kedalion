import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { GitCommit, GitRepoInfo, GitStatus } from '@kedalion/server-core/protocol';
import { request } from './api';
import { useLayout } from './layout';

/** Layout id of the Dossier layout: the project is the unit, its screens are chapters. */
export const DOSSIER_LAYOUT = 'dossier';

/** A project as the server lists it (`GET /api/projects`); the id is the one Explorer and Git use. */
export interface DossierProject {
  id: string;
  name: string;
  path: string;
}

/** The shared current project of the Dossier layout, kept in the webview's storage (no settings file change). */
const PROJECT_KEY = 'kedalion.dossier.project';
const listeners = new Set<() => void>();
let current: string | undefined = readProject();

function readProject(): string | undefined {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Switches every Dossier view to project `id`. */
export function setDossierProject(id: string | undefined): void {
  if (id === current) return;
  current = id;
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
  for (const fn of listeners) fn();
}

export interface DossierState {
  /** True when the Dossier layout is active. */
  active: boolean;
  /** The project every view shows in the Dossier layout. */
  project: string | undefined;
  setProject: (id: string | undefined) => void;
}

/** Whether the Dossier layout is active, with its shared current project; `layoutId` overrides the context (App, outside the provider). */
export function useDossier(layoutId?: string): DossierState {
  const ctx = useLayout().layout.id;
  const project = useSyncExternalStore(subscribe, () => current, () => current);
  return { active: (layoutId ?? ctx) === DOSSIER_LAYOUT, project, setProject: setDossierProject };
}

/**
 * Keeps a view's own project in step with the Dossier project while the layout is active: a Dossier switch picks it in
 * the view (`pick`), a pick inside the view becomes the Dossier project. `shown` is the project the view shows, `ids`
 * the projects it knows (undefined while loading). Other layouts: nothing happens.
 */
export function useDossierFollow(shown: string | undefined, ids: readonly string[] | undefined, pick: (id: string) => void): void {
  const { active, project } = useDossier();
  const prev = useRef(shown);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const known = ids?.join('\n');
  useEffect(() => {
    if (!active || known === undefined) return;
    const list = known ? known.split('\n') : [];
    const before = prev.current;
    prev.current = shown;
    if (before !== undefined && shown !== undefined && shown !== before && shown !== project) return setDossierProject(shown);
    if (project && project !== shown && list.includes(project)) pickRef.current(project);
    else if (shown && (!project || !list.includes(project))) setDossierProject(shown);
  }, [active, project, shown, known]);
}

/** What the Dossier shell shows: the projects with their git state, and the status of the current one. */
export interface DossierData {
  projects: DossierProject[] | undefined;
  repos: Map<string, GitRepoInfo>;
  /** Working-tree status of the current project (undefined when it is not a repository or not loaded). */
  status: GitStatus | undefined;
  reload: () => void;
}

interface Snapshot {
  projects: DossierProject[] | undefined;
  repos: Map<string, GitRepoInfo>;
  status: GitStatus | undefined;
}

let data: Snapshot = { projects: undefined, repos: new Map(), status: undefined };
const dataListeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let users = 0;

const subscribeData = (fn: () => void) => {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
};

function emit(next: Snapshot) {
  data = next;
  for (const fn of dataListeners) fn();
}

async function loadStatus(root: string | undefined, repos: Map<string, GitRepoInfo>): Promise<GitStatus | undefined> {
  if (!root || !repos.get(root)?.repo) return undefined;
  try {
    return await request<GitStatus>('GET', '/api/git/status', { root });
  } catch {
    return undefined;
  }
}

/** Loads the project list and git state once for every caller; a call during a load joins it. */
function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const [projects, infos] = await Promise.all([request<DossierProject[]>('GET', '/api/projects'), request<GitRepoInfo[]>('GET', '/api/git/repos').catch(() => [])]);
      const repos = new Map(infos.map((i) => [i.root, i]));
      const root = current;
      const status = await loadStatus(root, repos);
      // The project may have changed during the load: its own status load (useDossierData) fills it in then.
      emit({ projects, repos, status: root === current ? status : data.status });
    } catch {
      emit({ ...data, projects: data.projects ?? [] });
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

/** Interval of the git state refresh while the window is visible and focused, so git changes made elsewhere show up. */
const POLL_MS = 15_000;
let poll: ReturnType<typeof setInterval> | undefined;
const onFocus = () => void load();

/** The Dossier shell data; loads on first use, on window focus, when the project changes and every 15 s while focused. */
export function useDossierData(): DossierData {
  const snap = useSyncExternalStore(subscribeData, () => data, () => data);
  const { project } = useDossier();
  useEffect(() => {
    users++;
    if (users === 1) {
      void load();
      window.addEventListener('focus', onFocus);
      poll = setInterval(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) void load();
      }, POLL_MS);
    }
    return () => {
      users--;
      if (users === 0) {
        window.removeEventListener('focus', onFocus);
        clearInterval(poll);
        poll = undefined;
      }
    };
  }, []);
  useEffect(() => {
    if (!snap.projects) return;
    let live = true;
    void loadStatus(project, data.repos).then((status) => {
      if (live && project === current) emit({ ...data, status });
    });
    return () => {
      live = false;
    };
  }, [project, !!snap.projects]);
  const reload = useCallback(() => void load(), []);
  return { ...snap, reload };
}

/** The newest `limit` commits of `root`, or [] when it has none or is not a repository. */
export async function dossierLog(root: string, limit = 6): Promise<GitCommit[]> {
  return request<GitCommit[]>('GET', '/api/git/log', { root, skip: 0, limit });
}
