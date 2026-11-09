import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource, runAction } from '../../source';
import { PODS_FIELDS } from './fields';
import { parseEntries } from './model';
import { PodsPanel, type PodsConfig, type PodsPanelData } from './PodsPanel';
import { PodsActions } from './PodsActions';
import { PodsConfigEditor } from './PodsConfigEditor';
import { nextUnchanged, backoffMs } from './refresh';

type ClusterData = { entry: PodsPanelData['clusters'][number]; pods: PodsPanelData['pods'] };

/** The last result of each cluster, kept until its next one arrives. */
const lastByCluster = new Map<string, ClusterData>();
/** Refreshes in a row that found the same data, and the last data, per `clusters` setting. */
const unchanged = new Map<string, number>();
const lastSig = new Map<string, string>();

const clusterKey = (c: { context: string; namespace: string }) => `${c.context}\n${c.namespace}`;

/** One request per cluster, so a slow or dead cluster does not hold back the others. */
async function loadPods(config: PodsConfig, ctx: { signal: AbortSignal; auto: boolean; onPartial(data: PodsPanelData): void }): Promise<PodsPanelData> {
  const clusters = [...new Map(parseEntries(config.clusters).map((e) => [clusterKey(e), { context: e.context, namespace: e.namespace }])).values()];
  if (clusters.length === 0) return fetchSource<PodsPanelData>('pods', config, ctx.signal);
  const merged = (): PodsPanelData => {
    const have = clusters.flatMap((c) => lastByCluster.get(clusterKey(c)) ?? []);
    return { clusters: have.map((h) => h.entry), pods: have.flatMap((h) => h.pods) };
  };
  await Promise.all(
    clusters.map(async (c) => {
      const data = await runAction<PodsPanelData>('pods', 'cluster', config, c, ctx.signal);
      if (ctx.signal.aborted) return;
      lastByCluster.set(clusterKey(c), {
        entry: data.clusters.find((x) => clusterKey(x) === clusterKey(c)) ?? { ...c },
        pods: data.pods.filter((p) => clusterKey(p) === clusterKey(c)),
      });
      ctx.onPartial(merged());
    }),
  );
  const data = merged();
  const sig = JSON.stringify(data);
  unchanged.set(config.clusters, nextUnchanged(unchanged.get(config.clusters) ?? 0, lastSig.get(config.clusters) === sig, ctx.auto));
  lastSig.set(config.clusters, sig);
  return data;
}

const podsPanel = definePanel<PodsConfig, PodsPanelData>({
  kind: 'pods',
  title: 'dash.pods.panel',
  description: 'dash.pods.panel.description',
  icon: 'cube',
  category: 'dash.category.core',
  size: { w: 10, h: 12, minW: 5, minH: 5 },
  config: { fields: PODS_FIELDS },
  load: loadPods,
  refreshMs: (config) => backoffMs(Math.max(5, config.refreshSec || 30) * 1000, unchanged.get(config.clusters) ?? 0),
  pauseOffscreen: true,
  persist: true,
  allowMultiple: true,
  headerActions: PodsActions,
  configEditor: PodsConfigEditor,
  render: ({ id, config, data, refresh, side, setConfig }) => createElement(PodsPanel, { id, config, data, refresh, side, setConfig }),
});

export const panels: AnyPanelKind[] = [podsPanel];
