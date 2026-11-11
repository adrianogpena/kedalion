import { AppError } from '@kedalion/server-core';
import { declaredTooLarge, readLimited } from '../../connections/errors';
import { isHttpUrl } from './lines';

export interface HealthResult {
  label: string;
  url: string;
  /** HTTP status; 0 when the request failed or timed out. */
  status: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

const MAX_JSON_BYTES = 1_000_000;

const combine = (signal: AbortSignal, timeoutMs: number): AbortSignal => AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

/** GET `url` with a timeout; ok is a 2xx/3xx status. Never throws for network errors. */
export async function checkUrl(label: string, url: string, timeoutMs: number, signal: AbortSignal): Promise<HealthResult> {
  const started = performance.now();
  if (!isHttpUrl(url)) return { label, url, status: 0, latencyMs: 0, ok: false, error: 'invalid' };
  try {
    const res = await fetch(url, { signal: combine(signal, timeoutMs), redirect: 'manual' });
    await res.body?.cancel();
    const status = res.status;
    return { label, url, status, latencyMs: Math.round(performance.now() - started), ok: status >= 200 && status < 400 };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return { label, url, status: 0, latencyMs: Math.round(performance.now() - started), ok: false, error: timedOut ? 'timeout' : 'network' };
  }
}

/** GET a JSON document; only http(s), with a timeout and a size cap. */
export async function fetchJson(url: string, timeoutMs: number, signal: AbortSignal): Promise<unknown> {
  if (!isHttpUrl(url)) throw new AppError('invalid', 'dash.misc.badUrl', 'Only http(s) URLs are allowed');
  let res: Response;
  try {
    res = await fetch(url, { signal: combine(signal, timeoutMs), headers: { accept: 'application/json' } });
  } catch (err) {
    throw new AppError('internal', 'dash.misc.fetchFailed', 'Could not fetch the URL', { detail: err instanceof Error ? err.message : String(err) });
  }
  if (!res.ok) throw new AppError('internal', 'dash.misc.fetchFailed', `The URL answered ${res.status}`, { detail: String(res.status) });
  const tooLarge = () => new AppError('invalid', 'dash.misc.tooLarge', 'The response is too large');
  if (declaredTooLarge(res, MAX_JSON_BYTES)) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  const { text, truncated } = await readLimited(res, MAX_JSON_BYTES);
  if (truncated) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('invalid', 'dash.misc.notJson', 'The response is not JSON');
  }
}
