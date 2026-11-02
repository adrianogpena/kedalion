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
}

/** Applies the user agent, locale and timezone parts (the size is applied with the screencast); empty values reset. */
export async function applyEmulation(session: CdpSession, e: Emulation): Promise<void> {
  const quiet = (m: string, p: object) => session.send(m, p).catch(() => undefined);
  await Promise.all([
    quiet('Emulation.setUserAgentOverride', { userAgent: e.userAgent ?? '' }),
    quiet('Emulation.setLocaleOverride', e.locale ? { locale: e.locale } : {}),
    quiet('Emulation.setTimezoneOverride', { timezoneId: e.timezone ?? '' }),
  ]);
}
