import { describe, expect, test } from 'bun:test';
import { formatEntries, ingressUrls, isTracked, mapPods, matchesEntry, moveEntry, newPodWatch, parseClusters, parseEntries, podConfigMaps, podEvents, podRows } from './model';

const cluster = { context: 'dev', namespace: 'apps', patterns: ['api', 'web'] };

const podsJson = {
  items: [
    {
      metadata: { name: 'api-7d9f-abc', labels: { app: 'api' } },
      spec: { containers: [{ image: 'reg/api:1' }, { image: 'reg/side:2' }] },
      status: {
        phase: 'Running',
        startTime: '2026-01-01T10:00:00Z',
        containerStatuses: [
          { ready: true, restartCount: 2, lastState: { terminated: { finishedAt: '2026-01-02T00:00:00Z' } }, state: { running: {} } },
          { ready: true, restartCount: 1, lastState: { terminated: { finishedAt: '2026-01-03T00:00:00Z' } }, state: { running: {} } },
        ],
      },
    },
    {
      metadata: { name: 'Web-1' },
      spec: { containers: [{ image: 'reg/web:1' }] },
      status: { phase: 'Running', containerStatuses: [{ ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
    },
    { metadata: { name: 'db-0' }, status: { phase: 'Running' } },
    {
      metadata: { name: 'api-job' },
      status: { phase: 'Succeeded', containerStatuses: [{ ready: false, state: { terminated: { reason: 'Completed' } } }] },
    },
  ],
};

describe('parseClusters', () => {
  test('parses lines and skips malformed ones', () => {
    const text = 'dev apps api,Web\n# note\n\nbad\nprod ns-1 x';
    expect(parseClusters(text)).toEqual([
      { context: 'dev', namespace: 'apps', patterns: ['api', 'web'] },
      { context: 'prod', namespace: 'ns-1', patterns: ['x'] },
    ]);
  });
  test('rejects an invalid namespace', () => {
    expect(parseClusters('dev Bad;ns api')).toEqual([]);
  });
});

describe('isTracked', () => {
  test('matches case-insensitive substrings', () => {
    expect(isTracked('My-API-1', ['api'])).toBe(true);
    expect(isTracked('db-0', ['api'])).toBe(false);
    expect(isTracked('db-0', [])).toBe(false);
  });
});

describe('mapPods', () => {
  const pods = mapPods(podsJson, cluster);
  test('keeps only tracked pods', () => {
    expect(pods.map((p) => p.name)).toEqual(['api-7d9f-abc', 'Web-1', 'api-job']);
  });
  test('healthy pod', () => {
    expect(pods[0]).toMatchObject({ status: 'Running', healthy: true, ready: '2/2', restarts: 3, lastRestartAt: '2026-01-03T00:00:00Z', cluster: 'dev/apps', images: ['reg/api:1', 'reg/side:2'] });
  });
  test('waiting reason is the status', () => {
    expect(pods[1]).toMatchObject({ status: 'CrashLoopBackOff', healthy: false, ready: '0/1', restarts: 5 });
  });
  test('Completed is muted', () => {
    expect(pods[2]).toMatchObject({ status: 'Completed', tone: 'muted', healthy: false });
  });
  test('tones', () => {
    expect(pods[0]?.tone).toBe('ok');
    expect(pods[1]?.tone).toBe('err');
  });
});

describe('entries', () => {
  test('old comma lines become one entry per pattern', () => {
    expect(parseEntries('dev apps a,b\n\nbad\nprod ns-1 x')).toEqual([
      { context: 'dev', namespace: 'apps', pod: 'a' },
      { context: 'dev', namespace: 'apps', pod: 'b' },
      { context: 'prod', namespace: 'ns-1', pod: 'x' },
    ]);
  });
  test('format round trips', () => {
    const entries = [{ context: 'dev', namespace: 'apps', pod: 'vwde-24835' }];
    expect(parseEntries(formatEntries(entries))).toEqual(entries);
  });
  test('matchesEntry is a case-insensitive substring', () => {
    expect(matchesEntry('VWDE-24835-api-1', 'vwde-24835')).toBe(true);
    expect(matchesEntry('db-0', 'vwde')).toBe(false);
  });
});

describe('podRows', () => {
  const pods = mapPods(podsJson, cluster);
  test('a pod matched by two entries is listed once, empty entries get a row', () => {
    const entries = [
      { context: 'dev', namespace: 'apps', pod: 'api' },
      { context: 'dev', namespace: 'apps', pod: 'api-7d' },
      { context: 'dev', namespace: 'apps', pod: 'zzz' },
    ];
    const rows = podRows(entries, pods);
    expect(rows.map((r) => [r.entry.pod, r.pod?.name])).toEqual([
      ['api', 'api-7d9f-abc'],
      ['api', 'api-job'],
      ['zzz', undefined],
    ]);
  });
});

describe('podEvents', () => {
  const live = new Set(['dev/apps']);
  const kinds = (w: ReturnType<typeof newPodWatch>, pods: ReturnType<typeof mapPods>) => podEvents(w, pods, live).map((e) => [e.kind, e.pod.name, e.detail]);

  test('first poll is silent, a restart is one crash loop until the pod runs stable', () => {
    const w = newPodWatch();
    const pods = mapPods(podsJson, cluster);
    expect(kinds(w, pods)).toEqual([]);
    const restarted = pods.map((p, i) => (i === 0 ? { ...p, restarts: p.restarts + 1 } : p));
    expect(kinds(w, restarted)).toEqual([['crashloop', 'api-7d9f-abc', '4 restarts']]);
    const again = restarted.map((p, i) => (i === 0 ? { ...p, restarts: p.restarts + 1 } : p));
    expect(kinds(w, again)).toEqual([]);
  });

  test('OOMKilled restart is killed; a vanished pod is killed; a new healthy pod is running', () => {
    const w = newPodWatch();
    const pods = mapPods(podsJson, cluster);
    kinds(w, pods);
    const oom = pods.map((p, i) => (i === 0 ? { ...p, restarts: p.restarts + 1, lastReason: 'OOMKilled' } : p));
    expect(kinds(w, oom)).toEqual([['killed', 'api-7d9f-abc', 'OOMKilled']]);
    expect(kinds(w, oom.slice(0, 1))).toContainEqual(['killed', pods[1]!.name, 'Deleted']);
    expect(kinds(w, [...oom.slice(0, 1), { ...pods[0]!, name: 'api-new' }])).toEqual([['running', 'api-new', '']]);
  });

  test('an errored cluster is not compared', () => {
    const w = newPodWatch();
    kinds(w, mapPods(podsJson, cluster));
    expect(podEvents(w, [], new Set())).toEqual([]);
  });
});

describe('ingressUrls', () => {
  const ingress = {
    items: [
      {
        spec: {
          tls: [{ hosts: ['api.example.com'] }],
          rules: [
            { host: 'api.example.com', http: { paths: [{ path: '/', backend: { service: { name: 'api' } } }] } },
            { host: 'other.example.com', http: { paths: [{ path: '/x', backend: { service: { name: 'other' } } }] } },
            { host: 'plain.example.com', http: { paths: [{ path: '/v1', backend: { service: { name: 'api' } } }] } },
          ],
        },
      },
    ],
  };
  test('matches by label value', () => {
    expect(ingressUrls(ingress, { app: 'api' })).toEqual(['https://api.example.com', 'http://plain.example.com/v1']);
  });
  test('matches by pod name prefix', () => {
    expect(ingressUrls(ingress, {}, 'other-5f-x')).toEqual(['http://other.example.com/x']);
  });
  test('no match', () => {
    expect(ingressUrls(ingress, { app: 'zzz' }, 'zzz-1')).toEqual([]);
  });
});

describe('podConfigMaps', () => {
  test('collects volumes, env and envFrom', () => {
    const pod = {
      spec: {
        volumes: [{ configMap: { name: 'cfg-a' } }, { secret: { secretName: 's' } }, { projected: { sources: [{ configMap: { name: 'cfg-b' } }] } }],
        containers: [{ envFrom: [{ configMapRef: { name: 'cfg-c' } }], env: [{ valueFrom: { configMapKeyRef: { name: 'cfg-a' } } }] }],
      },
    };
    expect(podConfigMaps(pod)).toEqual(['cfg-a', 'cfg-b', 'cfg-c']);
  });
});

describe('moveEntry', () => {
  const e = (pod: string) => ({ context: 'c', namespace: 'n', pod });
  const list = [e('a'), e('b'), e('c')];

  test('moves an entry down and up', () => {
    expect(moveEntry(list, 0, 2).map((x) => x.pod)).toEqual(['b', 'c', 'a']);
    expect(moveEntry(list, 2, 0).map((x) => x.pod)).toEqual(['c', 'a', 'b']);
  });

  test('ignores same or out-of-range indexes and does not mutate', () => {
    expect(moveEntry(list, 1, 1)).toEqual(list);
    expect(moveEntry(list, 0, 5)).toEqual(list);
    expect(list.map((x) => x.pod)).toEqual(['a', 'b', 'c']);
  });
});
