import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, errorMessage, errorOf, Icon, PanelBanner, PanelLoading, PanelNotice, validConfig, type ApiError, type GridItem, type SidePanelContent } from '@kedalion/ui';
import { tKey } from './i18n';
import { fieldsOf, onRefreshRequest, type AnyPanelKind, type PanelSide } from './panel';

/** Last data per instance and config, so a collapsed or re-shown panel starts with what it had. */
const cache = new Map<string, unknown>();

const STORAGE_PREFIX = 'kedalion.panel.';
const MAX_STORED = 512 * 1024;

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (raw !== undefined && raw.length <= MAX_STORED) localStorage.setItem(STORAGE_PREFIX + key, raw);
  } catch {
    // storage full or unavailable: the panel just loads without a stored copy
  }
}

/** The cached data of `key`; a `persist` kind falls back to localStorage when memory misses. */
function cached(kind: AnyPanelKind, key: string): unknown {
  const hit = cache.get(key);
  if (hit !== undefined || !kind.persist) return hit;
  return readStored(key);
}

/** Last data another panel instance loaded (memory, then localStorage), for panels that show it elsewhere. */
export function lastPanelData<D>(id: string, kind: string, config: Record<string, unknown>): D | undefined {
  const key = `${id}:${kind}:${JSON.stringify(config)}`;
  return (cache.get(key) ?? readStored(key)) as D | undefined;
}

const intervalOf =(kind: AnyPanelKind, config: Record<string, unknown>, data: unknown): number => {
  const ms = typeof kind.refreshMs === 'function' ? kind.refreshMs(config, data) : kind.refreshMs;
  return ms && ms > 0 ? ms : 0;
};

/**
 * The one host every panel renders through: it validates the config, loads the data (with a loading
 * skeleton, an error with Retry, and a banner over the last data when a refresh fails), refreshes on the
 * kind's interval and renders the kind. A collapsed panel is not mounted, so it neither loads nor refreshes.
 */
export function PanelHost({ kind, item, onConfigure, side, setConfig }: {
  kind: AnyPanelKind;
  item: GridItem;
  onConfigure?: () => void;
  side?: PanelSide;
  setConfig?: (next: any) => void;
}) {
  const config = useMemo(() => validConfig(fieldsOf(kind), item.config), [kind, item.config]);
  const size = { w: item.w, h: item.h };
  const configure = onConfigure ?? noop;
  const scoped = useMemo(() => (side ? scopedSide(side, kind.kind) : undefined), [side, kind.kind]);
  const extra = { side: scoped, setConfig };
  if (!kind.load) return <Rendered kind={kind} id={item.id} config={config} data={undefined} size={size} refresh={noop} configure={configure} {...extra} />;
  return <Loaded kind={kind} id={item.id} config={config} size={size} configure={configure} {...extra} />;
}

const noop = () => {};

/** The panel's side API with every tab wrapped in the panel's link scope, so links in the side content follow its setting. */
function scopedSide(side: PanelSide, kindId: string): PanelSide {
  const wrap = (content: SidePanelContent): SidePanelContent => ({
    ...content,
    tabs: content.tabs.map((tab) => ({
      ...tab,
      render: () => <div data-link-scope={`panel:${kindId}`} style={{ display: 'contents' }}>{tab.render()}</div>,
    })),
  });
  return {
    open: (content, tab) => side.open(wrap(content), tab),
    push: (content, tab) => side.push(wrap(content), tab),
    close: () => side.close(),
    isOpen: (id) => side.isOpen(id),
  };
}

interface HostProps {
  kind: AnyPanelKind;
  id: string;
  config: Record<string, unknown>;
  size: { w: number; h: number };
  configure: () => void;
  side?: PanelSide;
  setConfig?: (next: any) => void;
}

function Rendered({ kind, id, config, data, size, refresh, configure, side, setConfig }: HostProps & { data: unknown; refresh: () => void }) {
  return <>{kind.render({ id, config, data, size, refresh, configure, side, setConfig })}</>;
}

function Loaded({ kind, id, config, size, configure, side, setConfig }: HostProps) {
  const key = `${id}:${kind.kind}:${JSON.stringify(config)}`;
  const [data, setData] = useState<unknown>(() => cached(kind, key));
  const [error, setError] = useState<ApiError>();
  const generation = useRef(0);
  const abort = useRef<AbortController>();
  const latest = useRef({ kind, config, key });
  latest.current = { kind, config, key };

  const lastRun = useRef(0);
  const onscreen = useRef(true);
  const sentinel = useRef<HTMLSpanElement>(null);

  /** `auto` is true only for the interval; a click handler passing an event counts as manual. */
  const run = useCallback((auto?: unknown) => {
    const gen = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    lastRun.current = Date.now();
    const { kind: k, config: c, key: cacheKey } = latest.current;
    k.load!(c, {
      signal: controller.signal,
      auto: auto === true,
      onPartial: (value) => {
        if (gen === generation.current) setData(value);
      },
    })
      .then((value) => {
        if (gen !== generation.current) return;
        cache.set(cacheKey, value);
        if (k.persist) writeStored(cacheKey, value);
        setData(value);
        setError(undefined);
      })
      .catch((err) => {
        if (gen !== generation.current) return;
        setError(errorOf(err));
      });
  }, []);

  useEffect(() => {
    setData(cached(latest.current.kind, key));
    setError(undefined);
    run();
    return () => {
      generation.current++;
      abort.current?.abort();
    };
  }, [key, run]);

  useEffect(() => onRefreshRequest(kind.kind, run), [kind.kind, run]);

  const ms = intervalOf(kind, config, data);
  const pause = !!kind.pauseOffscreen;
  useEffect(() => {
    if (!ms) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && (!pause || onscreen.current)) run(true);
    }, ms);
    return () => window.clearInterval(timer);
  }, [ms, key, run, pause]);

  useEffect(() => {
    const target = sentinel.current?.parentElement;
    if (!pause || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1]?.isIntersecting ?? true;
      const wasHidden = !onscreen.current;
      onscreen.current = visible;
      if (visible && wasHidden && ms && Date.now() - lastRun.current >= ms) run(true);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      onscreen.current = true;
    };
  }, [pause, ms, run, data !== undefined]);

  const retry = (
    <Button size="sm" icon="refresh" title={tKey('common.retry')} onClick={run}>{tKey('common.retry')}</Button>
  );
  if (data === undefined) {
    if (!error) return <PanelLoading />;
    const setUp = (
      <Button size="sm" icon="settings" variant="primary" title={tKey('grid.setUp')} onClick={configure}>{tKey('grid.setUp')}</Button>
    );
    if (error.code === 'source-not-configured') {
      return <PanelNotice icon={<Icon name="alert" size={20} />} title={tKey('grid.notConfigured')} message={errorMessage(error)} action={setUp} />;
    }
    if (error.code === 'source-auth') {
      return (
        <PanelNotice
          icon={<Icon name="alert" size={20} />}
          tone="err"
          title={tKey('grid.authFailed')}
          message={errorMessage(error)}
          action={<>{setUp} {retry}</>}
        />
      );
    }
    return <PanelNotice icon={<Icon name="alert" size={20} />} tone="err" title={tKey('grid.loadFailed')} message={errorMessage(error)} action={retry} />;
  }
  return (
    <>
      {pause && <span ref={sentinel} hidden />}
      {error && <PanelBanner tone="err" action={retry}>{`${tKey('grid.refreshFailed')}: ${errorMessage(error)}`}</PanelBanner>}
      <Rendered kind={kind} id={id} config={config} data={data} size={size} refresh={run} configure={configure} side={side} setConfig={setConfig} />
    </>
  );
}
