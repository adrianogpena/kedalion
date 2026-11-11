import type { CdpSession } from './client.ts';

/** What a tab pretends to be. Every field is optional; an empty state is the real browser. */
export interface Emulation {
  /** Name of the preset the size came from, for display. */
  preset?: string;
  width?: number;
  height?: number;
  dpr?: number;
  mobile?: boolean;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  /** Bypass the HTTP cache. */
  cacheDisabled?: boolean;
  /** Network throttling preset. */
  network?: 'offline' | 'slow3g' | 'fast3g';
}

/** Network.emulateNetworkConditions parameters per preset (throughput in bytes/s, latency in ms). */
export const NETWORK_CONDITIONS: Record<NonNullable<Emulation['network']>, { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }> = {
  offline: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  slow3g: { offline: false, latency: 2000, downloadThroughput: Math.round((50 * 1024) / 8), uploadThroughput: Math.round((50 * 1024) / 8) },
  fast3g: { offline: false, latency: 562, downloadThroughput: Math.round((1.6 * 1024 * 1024 * 0.9) / 8), uploadThroughput: Math.round((750 * 1024 * 0.9) / 8) },
};

/** Applies the user agent, locale and timezone parts (the size is applied with the screencast); empty values reset. */
export async function applyEmulation(session: CdpSession, e: Emulation): Promise<void> {
  const quiet = (m: string, p: object) => session.send(m, p).catch(() => undefined);
  await Promise.all([
    quiet('Emulation.setUserAgentOverride', { userAgent: e.userAgent ?? '' }),
    quiet('Emulation.setLocaleOverride', e.locale ? { locale: e.locale } : {}),
    quiet('Emulation.setTimezoneOverride', { timezoneId: e.timezone ?? '' }),
    quiet('Network.setCacheDisabled', { cacheDisabled: !!e.cacheDisabled }),
    quiet('Network.emulateNetworkConditions', e.network ? NETWORK_CONDITIONS[e.network] : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
  ]);
}
