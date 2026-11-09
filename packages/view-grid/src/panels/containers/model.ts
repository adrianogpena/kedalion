export interface Container {
  id: string;
  name: string;
  /** Published ports as `host:container`, comma separated; empty when none. */
  ports: string;
  image: string;
  state: string;
  status: string;
  /** Epoch milliseconds, 0 when unknown. */
  created: number;
  pinned?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function fromAny(r: Record<string, unknown>, id: string, names: string, created: number, ports: string): Container {
  return { id, name: names || id.slice(0, 12), ports, image: str(r.Image), state: str(r.State), status: str(r.Status), created };
}

const uniq = (list: string[]): string => [...new Set(list)].join(', ');

function podmanPorts(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return uniq(
    v.flatMap((p) => {
      const o = p as Record<string, unknown> | null;
      return o && typeof o.host_port === 'number' && typeof o.container_port === 'number' ? [`${o.host_port}:${o.container_port}`] : [];
    }),
  );
}

function dockerPorts(v: unknown): string {
  return uniq([...str(v).matchAll(/(\d+)->(\d+)/g)].map((m) => `${m[1]}:${m[2]}`));
}

/** `podman ps -a --format json`: one JSON array. Invalid output gives an empty list. */
export function parsePodman(stdout: string): Container[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const names = Array.isArray(r.Names) ? str(r.Names[0]) : str(r.Names);
      const created = typeof r.Created === 'number' ? r.Created * 1000 : 0;
      return fromAny(r, str(r.Id), names, created, podmanPorts(r.Ports));
    });
}

/** `docker ps -a --format "{{json .}}"`: one JSON object per line. */
export function parseDocker(stdout: string): Container[] {
  const out: Container[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!r || typeof r !== 'object') continue;
    const ms = Date.parse(str(r.CreatedAt).replace(/ [A-Z]{3,4}$/, '').replace(' ', 'T').replace(/ ([+-]\d{4})/, '$1'));
    const names = str(r.Names).split(',')[0] ?? '';
    out.push(fromAny(r, str(r.ID), names, Number.isFinite(ms) ? ms : 0, dockerPorts(r.Ports)));
  }
  return out;
}

export const isMachineDown = (stderr: string): boolean => /cannot connect to podman|unable to connect to podman socket/i.test(stderr);

export const isDockerDown = (stderr: string): boolean =>
  /cannot connect to the docker daemon|error during connect|docker daemon is not running|failed to connect to the docker api/i.test(stderr);

/** Container names are `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; anything else (a leading `-` would read as an option) is refused. */
export const isContainerName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);

export type ContainerTone = 'ok' | 'warn' | 'danger' | 'neutral';

export function containerTone(c: Pick<Container, 'state' | 'status'>): ContainerTone {
  if (/unhealthy/i.test(c.status)) return 'danger';
  switch (c.state.toLowerCase()) {
    case 'running':
      return /starting/i.test(c.status) ? 'warn' : 'ok';
    case 'restarting':
    case 'paused':
      return 'warn';
    case 'exited':
    case 'dead':
      return /exited \((?!0\))/i.test(c.status) ? 'danger' : 'neutral';
    default:
      return 'neutral';
  }
}

/** Adds `name` to the pinned text, or removes it when already there. */
export function togglePinned(text: string, name: string): string {
  const list = parsePinned(text);
  return (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]).join('\n');
}

/** `name=path` per line: the host log file of each container. */
export function parseLogFiles(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const path = line.slice(i + 1).trim();
    if (isContainerName(name) && path) out[name] = path;
  }
  return out;
}

/** Sets the log file of `name` in the `name=path` text; an empty path removes it. */
export function setLogFile(text: string, name: string, path: string): string {
  const files = parseLogFiles(text);
  const clean = path.trim().replace(/[\r\n]/g, '');
  if (clean) files[name] = clean;
  else delete files[name];
  return Object.entries(files).map(([n, p]) => `${n}=${p}`).join('\n');
}

const slashed = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** `file` as a slash-separated path under the project folder `root`, or null when it is outside it. */
export function relativeIn(root: string, file: string): string | null {
  const base = slashed(root);
  const target = slashed(file);
  if (!base || target.length <= base.length) return null;
  const windows = /^[A-Za-z]:/.test(base) || root.includes('\\');
  const head = target.slice(0, base.length);
  const same = windows ? head.toLowerCase() === base.toLowerCase() : head === base;
  return same && target[base.length] === '/' ? target.slice(base.length + 1) : null;
}

export const parsePinned =(text: string): string[] => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** Pinned names first (in pinned order), then the rest by name. */
export function sortPinned(list: Container[], pinned: string[]): Container[] {
  const rank = (c: Container) => {
    const i = pinned.indexOf(c.name);
    return i < 0 ? Infinity : i;
  };
  return list
    .map((c) => ({ ...c, pinned: rank(c) !== Infinity }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
