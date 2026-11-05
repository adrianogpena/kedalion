import { podStatus, type Tone } from './status';

export interface PodsConfig {
  clusters: string;
  refreshSec: number;
  showHealthy: boolean;
  notify: boolean;
}

/** One tracked line: a context, a namespace and a full or partial pod name. */
export interface PodEntry {
  context: string;
  namespace: string;
  pod: string;
}

export interface PodRow {
  entry: PodEntry;
  pod: Pod | undefined;
}

export interface Cluster {
  context: string;
  namespace: string;
  patterns: string[];
}

export interface Pod {
  /** `<context>/<namespace>`. */
  cluster: string;
  context: string;
  namespace: string;
  name: string;
  status: string;
  /** Optional so hand-built pods in other panels' tests keep compiling; `mapPods` always sets it. */
  tone?: Tone;
  healthy: boolean;
  /** `ready/total` containers. */
  ready: string;
  restarts: number;
  lastRestartAt: string;
  /** Reason the last container run ended (`OOMKilled`, `Error`, ...); optional like `tone`. */
  lastReason?: string;
  startedAt: string;
  images: string[];
  labels: Record<string, string>;
  urls: string[];
}

export const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** One cluster per line: `<context> <namespace> <pattern>[,<pattern>…]`; blank lines, `#` comments and malformed lines are skipped. */
export function parseClusters(text: string): Cluster[] {
  const out: Cluster[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [context, namespace, rest = ''] = trimmed.split(/\s+/, 3);
    if (!context || !namespace || !DNS_1123.test(namespace)) continue;
    const patterns = rest.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    out.push({ context, namespace, patterns });
  }
  return out;
}

/** Case-insensitive substring match against any pattern; no patterns tracks nothing. */
export const isTracked = (name: string, patterns: readonly string[]): boolean => {
  const n = name.toLowerCase();
  return patterns.some((p) => p && n.includes(p.toLowerCase()));
};

/** One entry per line `<context> <namespace> <pod>`; old `<p1>,<p2>` lines split into one entry per pattern. */
export function parseEntries(text: string): PodEntry[] {
  const out: PodEntry[] = [];
  for (const c of parseClusters(text)) {
    for (const pod of c.patterns) out.push({ context: c.context, namespace: c.namespace, pod });
  }
  return out;
}

/** Whether an entry survives `formatEntries` then `parseEntries`: a DNS-1123 namespace, context and pod without whitespace. */
export const isEntryValid = (e: PodEntry): boolean =>
  e.context !== '' && !/\s/.test(e.context) && DNS_1123.test(e.namespace) && e.pod !== '' && !/\s/.test(e.pod);

export const formatEntries = (entries: readonly PodEntry[]): string =>
  entries.map((e) => `${e.context} ${e.namespace} ${e.pod}`).join('\n');

/** Case-insensitive substring match of the entry's pod text against the pod name. */
export const matchesEntry = (name: string, pod: string): boolean => !!pod && name.toLowerCase().includes(pod.toLowerCase());

/** Rows in entry order; a pod shows once, under the first entry that matches it. An entry without pods gets one empty row. */
export function podRows(entries: readonly PodEntry[], pods: readonly Pod[]): PodRow[] {
  const seen = new Set<string>();
  const rows: PodRow[] = [];
  for (const entry of entries) {
    let any = false;
    for (const pod of pods) {
      if (pod.context !== entry.context || pod.namespace !== entry.namespace || !matchesEntry(pod.name, entry.pod)) continue;
      any = true;
      const key = `${pod.context}/${pod.namespace}/${pod.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ entry, pod });
    }
    if (!any) rows.push({ entry, pod: undefined });
  }
  return rows;
}

/** A copy of `entries` with the entry at `from` moved to index `to`; out-of-range indexes return the list unchanged. */
export function moveEntry(entries: readonly PodEntry[], from: number, to: number): PodEntry[] {
  const next = [...entries];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

const podKey = (p: Pod) => `${p.context}/${p.namespace}/${p.name}`;

export type PodEventKind = 'crashloop' | 'running' | 'killed' | 'image';

export interface PodEvent {
  kind: PodEventKind;
  pod: Pod;
  /** Extra text for the toast line: restart count, `OOMKilled`, `Deleted`, the pull error. */
  detail: string;
}

/** What `podEvents` remembers between polls; shared by every panel instance so an event notifies once. */
export interface PodWatch {
  pods: Map<string, { restarts: number; healthy: boolean; status: string; crashing: boolean }>;
  /** Clusters (`<context>/<namespace>`) seen once; their first poll only records. */
  primed: Set<string>;
}

export const newPodWatch = (): PodWatch => ({ pods: new Map(), primed: new Set() });

const IMAGE_ERROR = /ImagePullBackOff|ErrImagePull|InvalidImageName/;

/**
 * Events since the last call: crash loop (restarts went up, or the status turned CrashLoopBackOff;
 * once per loop until it runs stable), running (a new or restarted pod became healthy), killed
 * (OOMKilled, or the pod left the list) and image error. Only the clusters in `live` (fetched
 * without error) are compared, and a cluster's first poll is silent.
 */
export function podEvents(watch: PodWatch, pods: readonly Pod[], live: ReadonlySet<string>): PodEvent[] {
  const out: PodEvent[] = [];
  for (const cluster of live) {
    const primed = watch.primed.has(cluster);
    watch.primed.add(cluster);
    const keys = new Set<string>();
    for (const pod of pods) {
      if (pod.cluster !== cluster) continue;
      const key = podKey(pod);
      keys.add(key);
      const prev = watch.pods.get(key);
      const next = { restarts: pod.restarts, healthy: pod.healthy, status: pod.status, crashing: prev?.crashing ?? false };
      watch.pods.set(key, next);
      if (!primed) continue;
      if (!prev) {
        if (pod.healthy) out.push({ kind: 'running', pod, detail: '' });
        continue;
      }
      const restarted = pod.restarts > prev.restarts;
      if (restarted && pod.lastReason === 'OOMKilled') out.push({ kind: 'killed', pod, detail: 'OOMKilled' });
      else if ((restarted || (pod.status === 'CrashLoopBackOff' && prev.status !== 'CrashLoopBackOff')) && !prev.crashing) {
        out.push({ kind: 'crashloop', pod, detail: `${pod.restarts} restarts` });
      }
      if (restarted || pod.status === 'CrashLoopBackOff') next.crashing = true;
      else if (pod.healthy) next.crashing = false;
      if (IMAGE_ERROR.test(pod.status) && !IMAGE_ERROR.test(prev.status)) out.push({ kind: 'image', pod, detail: pod.status });
      if (!prev.healthy && pod.healthy) out.push({ kind: 'running', pod, detail: '' });
    }
    for (const key of [...watch.pods.keys()]) {
      if (!key.startsWith(`${cluster}/`) || keys.has(key)) continue;
      const gone = watch.pods.get(key)!;
      watch.pods.delete(key);
      if (!primed) continue;
      const [context, namespace, ...name] = key.split('/');
      out.push({ kind: 'killed', pod: { context, namespace, name: name.join('/'), status: gone.status } as Pod, detail: 'Deleted' });
    }
  }
  return out;
}

interface ContainerStatus {
  ready?: boolean;
  restartCount?: number;
  image?: string;
  state?: { waiting?: { reason?: string }; terminated?: { reason?: string } };
  lastState?: { terminated?: { finishedAt?: string; reason?: string } };
}

interface PodJson {
  metadata?: { name?: string; labels?: Record<string, string>; creationTimestamp?: string };
  spec?: { containers?: { image?: string }[] };
  status?: { phase?: string; startTime?: string; containerStatuses?: ContainerStatus[] };
}

/** The tracked pods of a `get pods -o json` result. */
export function mapPods(json: unknown, cluster: Cluster): Pod[] {
  const items = (json as { items?: PodJson[] } | null)?.items ?? [];
  const pods: Pod[] = [];
  for (const p of items) {
    const name = p.metadata?.name ?? '';
    if (!name || !isTracked(name, cluster.patterns)) continue;
    const statuses = p.status?.containerStatuses ?? [];
    const { text: status, tone } = podStatus(p);
    const readyCount = statuses.filter((c) => c.ready).length;
    const total = statuses.length || (p.spec?.containers?.length ?? 0);
    let lastRestartAt = '';
    let lastReason = '';
    for (const c of statuses) {
      const at = c.lastState?.terminated?.finishedAt ?? '';
      if (at > lastRestartAt) {
        lastRestartAt = at;
        lastReason = c.lastState?.terminated?.reason ?? '';
      }
    }
    pods.push({
      cluster: `${cluster.context}/${cluster.namespace}`,
      context: cluster.context,
      namespace: cluster.namespace,
      name,
      status,
      tone,
      healthy: status === 'Running' && statuses.length > 0 && readyCount === statuses.length,
      ready: `${readyCount}/${total}`,
      restarts: statuses.reduce((n, c) => n + (c.restartCount ?? 0), 0),
      lastRestartAt,
      lastReason,
      startedAt: p.status?.startTime ?? p.metadata?.creationTimestamp ?? '',
      images: (p.spec?.containers ?? []).map((c) => c.image ?? '').filter(Boolean),
      labels: p.metadata?.labels ?? {},
      urls: [],
    });
  }
  return pods;
}

interface IngressJson {
  spec?: {
    tls?: { hosts?: string[] }[];
    rules?: { host?: string; http?: { paths?: { path?: string; backend?: { service?: { name?: string }; serviceName?: string } }[] } }[];
  };
}

/** URLs of the ingress rules whose backend service is named like one of the pod's label values or is a prefix of the pod name. */
export function ingressUrls(ingressJson: unknown, labels: Record<string, string>, podName = ''): string[] {
  const values = new Set(Object.values(labels));
  const urls = new Set<string>();
  for (const ing of (ingressJson as { items?: IngressJson[] } | null)?.items ?? []) {
    const tlsHosts = new Set((ing.spec?.tls ?? []).flatMap((t) => t.hosts ?? []));
    for (const rule of ing.spec?.rules ?? []) {
      if (!rule.host) continue;
      for (const path of rule.http?.paths ?? []) {
        const service = path.backend?.service?.name ?? path.backend?.serviceName ?? '';
        if (!service || !(values.has(service) || (podName && podName.startsWith(`${service}-`)))) continue;
        const p = path.path && path.path !== '/' ? path.path.replace(/\(.*$/, '') : '';
        urls.add(`${tlsHosts.has(rule.host) ? 'https' : 'http'}://${rule.host}${p}`);
      }
    }
  }
  return [...urls];
}

/** Names of the ConfigMaps a pod mounts or references (volumes, env, envFrom). */
export function podConfigMaps(podJson: unknown): string[] {
  const spec = (podJson as { spec?: Record<string, any> } | null)?.spec ?? {};
  const names = new Set<string>();
  for (const v of spec.volumes ?? []) {
    if (v.configMap?.name) names.add(v.configMap.name);
    for (const s of v.projected?.sources ?? []) if (s.configMap?.name) names.add(s.configMap.name);
  }
  for (const c of [...(spec.containers ?? []), ...(spec.initContainers ?? [])]) {
    for (const e of c.envFrom ?? []) if (e.configMapRef?.name) names.add(e.configMapRef.name);
    for (const e of c.env ?? []) if (e.valueFrom?.configMapKeyRef?.name) names.add(e.valueFrom.configMapKeyRef.name);
  }
  return [...names].filter((n) => DNS_1123.test(n) || /^[a-z0-9][-a-z0-9.]*[a-z0-9]$/.test(n));
}
