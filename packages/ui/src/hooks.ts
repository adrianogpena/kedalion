import { useCallback, useEffect, useRef, useState } from 'react';
import { errorOf, type QueryParams, request, type ApiError } from './api';
import { stream } from './stream';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `fn` whenever `deps` change and, if `intervalMs` > 0, on a timer.
 * Polls never overlap (a tick during a load queues one refresh after it), stale responses (from old deps)
 * are dropped, and hidden windows don't poll.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], intervalMs = 0): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const runRef = useRef<(background: boolean) => void>(() => {});
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback((background: boolean) => {
    // A poll during a load queues one refresh (not one per tick), run when the load ends.
    if (background && inFlight.current) {
      pending.current = true;
      return;
    }
    pending.current = false;
    // A foreground run supersedes any poll still in flight.
    if (!background) generation.current++;
    const gen = generation.current;
    inFlight.current = true;
    if (!background) setLoading(true);
    fnRef.current()
      .then((value) => {
        if (gen !== generation.current) return;
        setData(value);
        setError(undefined);
      })
      .catch((err) => {
        if (gen !== generation.current) return;
        setError(errorOf(err));
      })
      .finally(() => {
        if (gen !== generation.current) return;
        inFlight.current = false;
        setLoading(false);
        if (pending.current) runRef.current(true);
      });
  }, []);
  runRef.current = run;

  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    pending.current = false;
    setData(undefined);
    setError(undefined);
    run(false);
    // Deps are deliberately partial.
  }, deps);

  useEffect(() => {
    if (!intervalMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') run(true);
    }, intervalMs);
    return () => window.clearInterval(id);
    // Deps are deliberately partial.
  }, [intervalMs, ...deps]);

  const reload = useCallback(() => run(false), [run]);
  return { data, error, loading, reload };
}

export interface StreamState<T> {
  items: T[];
  running: boolean;
  error: ApiError | undefined;
  /** More than `maxItems` arrived: the request was aborted and `items` holds the first `maxItems`. */
  truncated: boolean;
  /** Clears the state and streams `path`; aborts the previous stream. */
  start: (path: string, params?: QueryParams) => void;
  /** Aborts the stream; keeps the items received so far, sets no error. */
  cancel: () => void;
}

/**
 * Reads an NDJSON route (see `stream`) into state. Items are batched into one update per animation
 * frame; a stream started earlier is aborted and anything it still delivers is dropped.
 */
export function useStream<T>(opts: { maxItems?: number } = {}): StreamState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [truncated, setTruncated] = useState(false);
  const maxItems = useRef(10_000);
  maxItems.current = opts.maxItems ?? 10_000;
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const pending = useRef<T[]>([]);
  const frame = useRef<number>();

  const flush = useCallback(() => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const batch = pending.current;
    pending.current = [];
    if (batch.length) setItems((prev) => prev.concat(batch));
  }, []);

  // Ends the current stream: later callbacks from it see a newer generation and do nothing.
  const stop = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = undefined;
    flush();
  }, [flush]);

  const start = useCallback((path: string, params: QueryParams = {}) => {
    stop();
    const gen = generation.current;
    const ac = new AbortController();
    controller.current = ac;
    let count = 0;
    setItems([]);
    setError(undefined);
    setTruncated(false);
    setRunning(true);
    stream(path, params, (item) => {
      if (gen !== generation.current || ac.signal.aborted) return;
      if (count >= maxItems.current) {
        setTruncated(true);
        ac.abort();
        return;
      }
      count++;
      pending.current.push(item as T);
      if (frame.current === undefined) frame.current = window.requestAnimationFrame(flush);
    }, ac.signal).then(
      () => {
        if (gen !== generation.current) return;
        flush();
        setRunning(false);
      },
      (err) => {
        if (gen !== generation.current) return;
        flush();
        if (!ac.signal.aborted) setError(errorOf(err));
        setRunning(false);
      },
    );
  }, [stop, flush]);

  const cancel = useCallback(() => {
    stop();
    setRunning(false);
  }, [stop]);

  useEffect(() => () => {
    generation.current++;
    controller.current?.abort();
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
  }, []);

  return { items, running, error, truncated, start, cancel };
}

/**
 * A stable `(value) => void` that calls `save` with the latest value once no new one came for
 * `delayMs`. A pending value is saved right away on unmount and when the page goes away (`pagehide`).
 */
export function useDebouncedSave<T>(save: (value: T) => void, delayMs = 500): (value: T) => void {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<number>();
  const pending = useRef<{ value: T }>();

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = undefined;
    if (p) saveRef.current(p.value);
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return useCallback((value: T) => {
    pending.current = { value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delayMs);
  }, [flush, delayMs]);
}

/** Tells the server a UI is still open (it may exit when idle); any other API call counts too. */
export function useHeartbeat(ms = 60_000) {
  useEffect(() => {
    const id = window.setInterval(() => {
      request('POST', '/api/alive').catch(() => { /* the next beat retries */ });
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
