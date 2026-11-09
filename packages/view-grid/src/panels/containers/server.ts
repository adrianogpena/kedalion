import { isAbsolute } from 'node:path';
import { runCli } from '../../cli';
import { notifyChanges, notifyScope } from '../../notify-changes';
import { defineSource,SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { CONTAINERS_FIELDS } from './fields';
import { isContainerName, isDockerDown, isMachineDown, parseDocker, parsePinned, parsePodman, sortPinned, type Container } from './model';

interface ContainersConfig {
  engine: string;
  pinned: string;
  logFiles: string;
  showStopped: boolean;
  [key: string]: unknown;
}

export interface ContainersData {
  machineDown: boolean;
  engine: 'podman' | 'docker';
  containers: Container[];
}

const engineOf = (config: ContainersConfig): 'podman' | 'docker' => (config.engine === 'docker' ? 'docker' : 'podman');

async function list(config: ContainersConfig, signal?: AbortSignal): Promise<ContainersData> {
  const engine = engineOf(config);
  const argv = engine === 'docker' ? ['docker', 'ps', '-a', '--format', '{{json .}}'] : ['podman', 'ps', '-a', '--format', 'json'];
  const r = await runCli(argv, { timeoutMs: 30_000, signal });
  if (r.code !== 0) {
    if (engine === 'podman' ? isMachineDown(r.stderr) : isDockerDown(r.stderr)) return { machineDown: true, engine, containers: [] };
    throw SourceError('upstream', `${engine} failed.`, r.stderr.trim() || `exit ${r.code}`);
  }
  const all = engine === 'docker' ? parseDocker(r.stdout) : parsePodman(r.stdout);
  return { machineDown: false, engine, containers: sortPinned(all, parsePinned(config.pinned ?? '')) };
}

const nameOf = (payload: unknown): string => {
  const name = (payload as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || !isContainerName(name)) throw SourceError('upstream', 'Invalid container name.');
  return name;
};

async function control(verb: 'start' | 'stop' | 'restart', payload: unknown, config: ContainersConfig, signal: AbortSignal): Promise<null> {
  const engine = engineOf(config);
  const r = await runCli([engine, verb, nameOf(payload)], { timeoutMs: 60_000, signal });
  if (r.code !== 0) throw SourceError('upstream', `${engine} ${verb} failed.`, r.stderr.trim() || `exit ${r.code}`);
  return null;
}

const LOG_TAIL = 500;
const FILE_TAIL_BYTES = 512 * 1024;

/** The last lines of a text file on this machine (a container's host-side log file). */
async function fileLogs(payload: unknown): Promise<{ lines: string[] }> {
  const path = (payload as { path?: unknown } | null)?.path;
  if (typeof path !== 'string' || !path || path.length > 1000 || path.includes('\0') || !isAbsolute(path)) {
    throw SourceError('upstream', 'Enter an absolute file path.');
  }
  const file = Bun.file(path);
  if (!(await file.exists())) throw SourceError('upstream', 'File not found.', path);
  const size = file.size;
  const text = await file.slice(Math.max(0, size - FILE_TAIL_BYTES), size).text();
  const lines = text.split(/\r?\n/);
  if (size > FILE_TAIL_BYTES) lines.shift();
  return { lines: lines.filter((l) => l !== '').slice(-LOG_TAIL) };
}

async function logs(payload: unknown, config: ContainersConfig, signal: AbortSignal): Promise<{ lines: string[] }> {
  const engine = engineOf(config);
  const r = await runCli([engine, 'logs', '--tail', String(LOG_TAIL), nameOf(payload)], { timeoutMs: 30_000, signal });
  if (r.code !== 0) throw SourceError('upstream', `${engine} logs failed.`, r.stderr.trim() || `exit ${r.code}`);
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l !== '');
  return { lines: lines.slice(-LOG_TAIL) };
}

export const containersSource = defineSource<ContainersConfig>({
  id: 'containers',
  fields: CONTAINERS_FIELDS,
  async fetch(config, ctx) {
    const data = await list(config, ctx.signal);
    if (config.notify !== false && !data.machineDown) {
      const up = (c: Container) => c.state === 'running' && !/unhealthy/i.test(c.status);
      notifyChanges(ctx, notifyScope('containers', { engine: config.engine }), data.containers, {
        key: (c) => c.name,
        sig: (c) => (up(c) ? 'up' : 'down'),
        title: 'Containers',
        line: (c) => (up(c) ? `${c.name} recovered` : `${c.name} is ${/unhealthy/i.test(c.status) ? 'unhealthy' : c.state || 'stopped'}`),
      });
    }
    return data;
  },
  actions: {
    start: (payload, config, ctx) => control('start', payload, config, ctx.signal),
    stop: (payload, config, ctx) => control('stop', payload, config, ctx.signal),
    restart: (payload, config, ctx) => control('restart', payload, config, ctx.signal),
    logs: (payload, config, ctx) => logs(payload, config, ctx.signal),
    'file-logs': (payload) => fileLogs(payload),
    async 'machine-start'(_payload, config, ctx) {
      if (engineOf(config) !== 'podman') throw SourceError('upstream', 'Only Podman has a machine.');
      const r = await runCli(['podman', 'machine', 'start'], { timeoutMs: 120_000, signal: ctx.signal });
      if (r.code !== 0) throw SourceError('upstream', 'podman machine start failed.', r.stderr.trim() || `exit ${r.code}`);
      return null;
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'containers', fields: CONTAINERS_FIELDS, allowMultiple: true }];

export const sources: DataSource<any>[] = [containersSource];
