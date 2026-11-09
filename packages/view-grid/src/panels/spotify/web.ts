import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { SPOTIFY_FIELDS } from './fields';
import type { SpotifyData } from './map';
import { SpotifyPanel, type SpotifyConfig } from './SpotifyPanel';

const spotifyPanel = definePanel<SpotifyConfig, SpotifyData>({
  kind: 'spotify',
  title: 'dash.spotify.panel',
  description: 'dash.spotify.panel.description',
  icon: 'audio',
  category: 'dash.category.daily',
  size: { w: 6, h: 18, minW: 4, minH: 8 },
  config: { fields: SPOTIFY_FIELDS },
  load: (config, ctx) => fetchSource<SpotifyData>('spotify', { clientId: config.clientId }, ctx.signal),
  refreshMs: (_config, data) => (data && !data.connected ? 3_000 : 4_000),
  pauseOffscreen: true,
  allowMultiple: false,
  render: ({ config, data, refresh, configure }) => createElement(SpotifyPanel, { config, data, refresh, configure }),
});

/** The Spotify panel kind. */
export const panels: AnyPanelKind[] = [spotifyPanel];
