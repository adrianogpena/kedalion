import { runAction } from '../../source';
import type { FxConfig } from './ExchangeRate';
import { currencyCode } from './fx';
import { parseFxHistories, parseFxHistory, pairKey, type FxHistory } from './fx-history';

const SOURCE = 'feeds-fx';
const EVENT = 'fx-history';
/** Where versions before the server store kept the history (per browser profile). */
const OLD_KEY = 'kedalion.fx-history';

const pairOf = (config: FxConfig) => pairKey(currencyCode(config.base, 'EUR'), currencyCode(config.quote, 'BRL'));

/** The saved history of the panel's pair (kept by the server in `~/.kedalion`). */
export async function readFxHistory(config: FxConfig): Promise<FxHistory> {
  return parseFxHistory(await runAction(SOURCE, 'history', config));
}

/** Tells open side panels that the pair of `config` has a new fetch. */
export function announceFx(config: FxConfig): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pairOf(config) }));
}

/** Calls `run` when the history of the pair of `config` changes; returns the unsubscribe. */
export function onFxHistory(config: FxConfig, run: () => void): () => void {
  const pair = pairOf(config);
  const handler = (e: Event) => {
    if ((e as CustomEvent<string>).detail === pair) run();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

let imported = false;

/** Moves the history this browser profile saved before the server store into the server, once. */
export async function importOldFxHistory(config: FxConfig): Promise<void> {
  if (imported) return;
  imported = true;
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return;
    const old = parseFxHistories(JSON.parse(raw));
    if (Object.keys(old).length === 0) return;
    await runAction(SOURCE, 'import', config, old);
    localStorage.removeItem(OLD_KEY);
  } catch {
    imported = false;
  }
}
