import { useState } from 'react';
import { ContextMenu, IconButton } from '@kedalion/ui';
import { tKey } from '../../i18n';
import type { PanelSide } from '../../panel';
import type { FxConfig } from './ExchangeRate';
import { currencyCode, parseTrack } from './fx';
import { fxSideContent } from './FxSide';

type Pair = { base: string; quote: string };

const label = (p: Pair) => `${p.base} > ${p.quote}`;

/** The shown pair first, then the tracked ones. */
const pairsOf = (config: FxConfig): Pair[] => {
  const main = { base: currencyCode(config.base, 'EUR'), quote: currencyCode(config.quote, 'BRL') };
  return [main, ...parseTrack(config.track, `${main.base}>${main.quote}`)];
};

/** Shows `pair` and keeps every other pair tracked, so each history keeps growing. */
const showPair = (config: FxConfig, pair: Pair): FxConfig => {
  const others = pairsOf(config).filter((p) => p.base !== pair.base || p.quote !== pair.quote);
  return { ...config, base: pair.base, quote: pair.quote, track: others.map((p) => `${p.base}>${p.quote}`).join(', ') };
};

export function FxActions({ config, setConfig, side }: { config: FxConfig; setConfig?(next: FxConfig): void; side?: PanelSide }) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const pairs = pairsOf(config);
  return (
    <>
      {setConfig && pairs.length > 1 && (
        <IconButton
          icon="chevron-down"
          label={tKey('dash.feeds.fx.pair')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom });
          }}
        />
      )}
      {side && <IconButton icon="history" label={tKey('dash.feeds.fx.history')} onClick={() => side.open(fxSideContent(config))} />}
      {menuAt && setConfig && (
        <ContextMenu
          at={menuAt}
          onClose={() => setMenuAt(null)}
          items={pairs.map((p, i) => ({ id: label(p), label: label(p), radio: true, checked: i === 0, run: () => setConfig(showPair(config, p)) }))}
        />
      )}
    </>
  );
}
