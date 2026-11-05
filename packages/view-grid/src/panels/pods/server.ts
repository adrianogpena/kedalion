import { AppError, ndjson } from '@kedalion/server-core';
import { runCli } from '../../cli';
import { parseTail, PodLogHub, validateTarget } from './logs';
import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { notifyLines } from '../../notify-changes';
import { PODS_FIELDS } from './fields';
import { classifyStderr, type KubeError } from './kube-errors';
import { parseMetrics, sanitizePod, type PodUsage } from './detail';
import { kubePaths, kubeProxy, ProxyUnavailable } from './proxy';
import { DNS_1123, ingressUrls, mapPods, newPodWatch, podEvents, type PodEventKind, parseEntries, podConfigMaps, type Cluster, type Pod, type PodEntry, type PodsConfig as PodsSettings } from './model';

type PodsConfig = PodsSettings & { [key: string]: unknown };

export interface PodsData {
  clusters: { context: string; namespace: string; error?: KubeError }[];
  pods: Pod[];
}

const TIMEOUT_MS = 30_000;
/** Timeout of the list calls (`get pods`, `get ingress`), so a dead cluster fails fast. */
const LIST_TIMEOUT_MS = 10_000;
const INGRESS_CACHE_MS = 5 * 60_000;

const ingressCache = new Map<string, { at: number; json: unknown }>();

/** What one cluster last returned, so the merged set is judged as a whole. */
const clusterResults = new Map<string, ClusterResult>();

interface ClusterResult {
  c: Cluster;
  pods: Pod[];
  error?: KubeError;
}

const clusterKey = (c: { context: string; namespace: string }) => `${c.context}\n${c.namespace}`;

const logHub = new PodLogHub();

let latest: Pod[] = [];

/** Pod state seen so far, shared by every panel instance so an event notifies once. */
const podWatch = newPodWatch();

const POD_HEADING: Record<PodEventKind, string> = { crashloop: 'CrashLoop', running: 'Running', killed: 'Killed', image: 'Image error' };

/** One cluster per distinct (context, namespace), with the pod texts of its entries. */
export function groupEntries(entries: readonly PodEntry[]): Cluster[] {
  const groups = new Map<string, Cluster>();
  for (const e of entries) {
    const key = `${e.context}\n${e.namespace}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { context: e.context, namespace: e.namespace, patterns: [] }));
    if (!g.patterns.includes(e.pod)) g.patterns.push(e.pod);
  }
  return [...groups.values()];
}

/** The pods of the last fetch (kept in memory only, never written to disk). */
export const latestPods = (): Pod[] => latest;

const kubectl = (c: { context: string; namespace: string }, args: string[], signal?: AbortSignal, timeoutMs = TIMEOUT_MS) =>
  runCli(['kubectl', '--context', c.context, '-n', c.namespace, ...args], { timeoutMs, signal });

async function json(c: Cluster, args: string[], signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
  const r = await kubectl(c, [...args, '-o', 'json'], signal, timeoutMs);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `kubectl exited with ${r.code}`);
  return JSON.parse(r.stdout);
}

/** A read through the context's `kubectl proxy`; when the proxy cannot start or be reached, `fallback` (the plain kubectl call) runs instead. An API error is a real error. */
async function viaProxy(context: string, path: () => string, signal: AbortSignal | undefined, timeoutMs: number, fallback: () => Promise<unknown>): Promise<unknown> {
  try {
    return await kubeProxy.apiGet(context, path(), signal, timeoutMs);
  } catch (err) {
    if (!(err instanceof ProxyUnavailable) || signal?.aborted) throw err;
    return fallback();
  }
}

const podJsonOf = (c: Cluster, pod: string, signal?: AbortSignal) =>
  viaProxy(c.context, () => kubePaths.pod(c.namespace, pod), signal, TIMEOUT_MS, () => json(c, ['get', 'pod', pod], signal));

/** The ingress list of a cluster, cached for a few minutes; a failure is not cached. */
async function ingressJson(c: Cluster, signal: AbortSignal): Promise<unknown> {
  const key = clusterKey(c);
  const hit = ingressCache.get(key);
  if (hit && Date.now() - hit.at < INGRESS_CACHE_MS) return hit.json;
  const value = await viaProxy(c.context, () => kubePaths.ingresses(c.namespace), signal, LIST_TIMEOUT_MS, () => json(c, ['get', 'ingress'], signal, LIST_TIMEOUT_MS));
  ingressCache.set(key, { at: Date.now(), json: value });
  return value;
}

async function fetchCluster(c: Cluster, signal: AbortSignal): Promise<Pod[]> {
  // An ingress failure is ignored: a pods failure (or an abort) surfaces from the pods call.
  const podsCall = viaProxy(c.context, () => kubePaths.pods(c.namespace), signal, LIST_TIMEOUT_MS, () => json(c, ['get', 'pods'], signal, LIST_TIMEOUT_MS));
  const [podsJson, ingress] = await Promise.all([podsCall, ingressJson(c, signal).catch(() => undefined)]);
  const pods = mapPods(podsJson, c);
  if (ingress !== undefined) for (const p of pods) p.urls = ingressUrls(ingress, p.labels, p.name);
  return pods;
}

/** Fetches one cluster; a kubectl failure becomes `error`, an abort or a missing kubectl throws. */
async function fetchOne(c: Cluster, signal: AbortSignal): Promise<ClusterResult> {
  let result: ClusterResult;
  try {
    result = { c, pods: await fetchCluster(c, signal) };
  } catch (err) {
    if (signal.aborted || (err instanceof AppError && err.code === 'source-tool-missing')) throw err;
    result = { c, pods: [], error: classifyStderr(String((err as Error)?.message ?? err)) };
  }
  clusterResults.set(clusterKey(c), result);
  return result;
}

/** Merges the last results of `clusters`, remembers the pods and notifies health changes on the merged set. */
function publish(config: PodsConfig, clusters: readonly Cluster[], notify?: (n: { title?: string; body: string }) => Promise<void>): PodsData {
  const out: PodsData = { clusters: [], pods: [] };
  for (const c of clusters) {
    const r = clusterResults.get(clusterKey(c));
    if (!r) continue;
    out.clusters.push({ context: c.context, namespace: c.namespace, ...(r.error ? { error: r.error } : {}) });
    out.pods.push(...r.pods);
  }
  latest = out.pods;
  if (config.notify !== false && notify) {
    const live = new Set(out.clusters.filter((c) => !c.error).map((c) => `${c.context}/${c.namespace}`));
    notifyLines(
      notify,
      'Pods',
      podEvents(podWatch, out.pods, live).map((e) => ({
        heading: POD_HEADING[e.kind],
        line: `${e.pod.context}/${e.pod.namespace}/${e.pod.name}${e.detail ? ` (${e.detail})` : ''}`,
      })),
    );
  }
  return out;
}

export function pick(config: { clusters: string }, payload: unknown): { cluster: Cluster; pod: string } {
  const p = (payload ?? {}) as { context?: unknown; namespace?: unknown; pod?: unknown };
  const cluster = groupEntries(parseEntries(config.clusters)).find((c) => c.context === p.context && c.namespace === p.namespace);
  if (!cluster) throw SourceError('not-configured', 'The cluster is not in the panel settings.');
  if (typeof p.pod !== 'string' || !DNS_1123.test(p.pod)) throw SourceError('upstream', 'Invalid pod name.');
  return { cluster, pod: p.pod };
}

async function text(c: Cluster, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await kubectl(c, args, signal);
  if (r.code !== 0) throw SourceError('upstream', 'kubectl failed.', r.stderr.trim() || r.stdout.trim());
  return r.stdout;
}

/** The contexts of a `kubectl config view -o json` output. */
export function readContexts(stdout: string): { contexts: { name: string; namespace?: string }[]; current?: string } {
  let cfg: { contexts?: { name?: unknown; context?: { namespace?: unknown } }[]; 'current-context'?: unknown };
  try {
    cfg = JSON.parse(stdout);
  } catch {
    return { contexts: [] };
  }
  const contexts = (cfg.contexts ?? []).flatMap((c) =>
    typeof c.name === 'string' ? [{ name: c.name, ...(typeof c.context?.namespace === 'string' && c.context.namespace ? { namespace: c.context.namespace } : {}) }] : [],
  );
  return { contexts, ...(typeof cfg['current-context'] === 'string' && cfg['current-context'] ? { current: cfg['current-context'] } : {}) };
}

export const podsSource =defineSource<PodsConfig>({
  id: 'pods',
  fields: PODS_FIELDS,
  async fetch(config, ctx) {
    const clusters = groupEntries(parseEntries(config.clusters));
    await Promise.all(clusters.map((c) => fetchOne(c, ctx.signal)));
    return publish(config, clusters, ctx.notify);
  },
  streams: {
    logs(query, ctx) {
      const target = validateTarget({ context: query.get('context'), namespace: query.get('namespace'), pod: query.get('pod') });
      if (!target) throw SourceError('upstream', 'Invalid pod, context or namespace.');
      const tail = parseTail(query.get('tail'));
      return ndjson(ctx.req, async (emit, signal) => {
        let chain: Promise<void> = Promise.resolve();
        let leave = () => {};
        const done = new Promise<void>((resolve) => {
          leave = logHub.subscribe(target, tail, (m) => {
            chain = chain.then(() => emit(m));
            if ('status' in m && m.status === 'ended') chain = chain.then(resolve);
          });
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        try {
          await done;
          await chain;
        } finally {
          leave();
        }
      });
    },
  },
  actions: {
    /** One cluster of the config, so the panel shows each as soon as it answers; the data is the merge of the last results. */
    async cluster(payload, config, ctx) {
      const p = (payload ?? {}) as { context?: unknown; namespace?: unknown };
      const clusters = groupEntries(parseEntries(config.clusters));
      const c = clusters.find((x) => x.context === p.context && x.namespace === p.namespace);
      if (!c) throw SourceError('not-configured', 'The cluster is not in the panel settings.');
      await fetchOne(c, ctx.signal);
      return publish(config, clusters, ctx.notify);
    },
    async contexts(_payload, _config, ctx) {
      const r = await runCli(['kubectl', 'config', 'view', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
      if (r.code !== 0) throw SourceError('upstream', 'kubectl failed.', r.stderr.trim());
      return readContexts(r.stdout);
    },
    async namespaces(payload, _config, ctx) {
      const context = (payload as { context?: unknown } | null)?.context;
      if (typeof context !== 'string') throw SourceError('upstream', 'Invalid context.');
      try {
        const known = await runCli(['kubectl', 'config', 'view', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
        if (known.code !== 0 || !readContexts(known.stdout).contexts.some((c) => c.name === context)) throw SourceError('upstream', 'Unknown context.');
        const list = await viaProxy(context, kubePaths.namespaces, ctx.signal, TIMEOUT_MS, async () => {
          const r = await runCli(['kubectl', '--context', context, 'get', 'namespaces', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
          if (r.code !== 0) throw new Error(r.stderr.trim());
          return JSON.parse(r.stdout);
        });
        const items = (list as { items?: { metadata?: { name?: unknown } }[] }).items ?? [];
        return items.map((i) => i.metadata?.name).filter((n): n is string => typeof n === 'string');
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        return [];
      }
    },
    async detail(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      const metrics = async (): Promise<PodUsage | undefined> => {
        try {
          const raw = await viaProxy(cluster.context, () => kubePaths.podMetrics(cluster.namespace, pod), ctx.signal, TIMEOUT_MS, async () => {
            const r = await runCli(['kubectl', '--context', cluster.context, 'get', '--raw', kubePaths.podMetrics(cluster.namespace, pod)], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
            if (r.code !== 0) throw new Error(r.stderr.trim());
            return JSON.parse(r.stdout);
          });
          return parseMetrics(raw);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
        }
        return undefined;
      };
      const events = async (): Promise<unknown> => {
        try {
          return await viaProxy(cluster.context, () => kubePaths.podEvents(cluster.namespace, pod), ctx.signal, TIMEOUT_MS, () =>
            json(cluster, ['get', 'events', '--field-selector', `involvedObject.name=${pod},involvedObject.kind=Pod`], ctx.signal),
          );
        } catch (err) {
          if (ctx.signal.aborted) throw err;
        }
        return undefined;
      };
      const [podJson, usage, eventList] = await Promise.all([podJsonOf(cluster, pod, ctx.signal), metrics(), events()]);
      return { pod: sanitizePod(podJson), ...(usage ? { usage } : {}), ...(eventList ? { events: eventList } : {}) };
    },
    async restart(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      await text(cluster, ['delete', 'pod', pod], ctx.signal);
      return null;
    },
    async describe(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      // The three calls are independent; a pod or ingress failure only drops its section (an abort still throws).
      const tolerant = <T>(p: Promise<T>) =>
        p.catch((err) => {
          if (ctx.signal.aborted) throw err;
          return undefined;
        });
      const [described, podJson, ingress] = await Promise.all([
        text(cluster, ['describe', 'pod', pod], ctx.signal),
        tolerant(podJsonOf(cluster, pod, ctx.signal) as Promise<{ metadata?: { labels?: Record<string, string> } }>),
        tolerant(ingressJson(cluster, ctx.signal)),
      ]);
      const parts = [described];
      const maps = podJson ? podConfigMaps(podJson) : [];
      const urls = podJson && ingress !== undefined ? ingressUrls(ingress, podJson.metadata?.labels ?? {}, pod) : [];
      if (urls.length) parts.push(`\n===== Ingress =====\n${urls.join('\n')}\n`);
      const mapTexts = await Promise.all(
        maps.map((name) =>
          text(cluster, ['describe', 'configmap', name], ctx.signal).then(
            (out) => `\n===== ConfigMap ${name} =====\n${out}`,
            () => `\n===== ConfigMap ${name} =====\n(unavailable)\n`,
          ),
        ),
      );
      parts.push(...mapTexts);
      return parts.join('\n');
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'pods', fields: PODS_FIELDS, allowMultiple: true }];

export const sources: DataSource<any>[] = [podsSource];
