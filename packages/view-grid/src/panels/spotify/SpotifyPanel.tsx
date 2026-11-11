import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Button, ContextMenu, copyNotify, errorMessage, errorOf } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip, ListRows, type ListRow } from '../../kit';
import { runAction } from '../../source';
import { fmtClock, nextRepeat, type Device, type Player, type SpotifyData } from './map';
import './spotify.css';

export interface SpotifyConfig {
  clientId: string;
  [key: string]: unknown;
}

interface Props {
  config: SpotifyConfig;
  data: SpotifyData | undefined;
  refresh(): void;
  configure(): void;
}

const REFRESH_DELAY_MS = 350;

export function SpotifyPanel({ config, data, refresh, configure }: Props) {
  const [opt, setOpt] = useState<Partial<Player>>({});
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'recent' | 'playlists'>('recent');
  const [, tick] = useState(0);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  const since = useMemo(() => Date.now(), [data, opt.progressMs]);
  useEffect(() => setOpt({}), [data]);
  const playing = !!data?.player?.playing && opt.playing !== false;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [playing]);

  if (!data) return null;
  const cfg = { clientId: config.clientId };

  const act = async (name: string, payload?: unknown, patch?: Partial<Player>) => {
    setError('');
    if (patch) setOpt((o) => ({ ...o, ...patch }));
    try {
      return await runAction<any>('spotify', name, cfg, payload);
    } catch (err) {
      setError(errorMessage(errorOf(err)));
    } finally {
      setTimeout(refresh, REFRESH_DELAY_MS);
    }
  };

  if (!data.connected) {
    const connect = async () => {
      const r = await act('connect');
      if (r?.url) window.open(r.url, '_blank', 'noreferrer');
    };
    return (
      <div className="sp sp-setup">
        <p className="sp-note">{tKey('dash.spotify.setup')}</p>
        <label className="sp-note">{tKey('dash.spotify.redirectUri')}</label>
        <div className="sp-uri">
          <code>{data.redirectUri}</code>
          <Button size="xs" onClick={() => void navigator.clipboard?.writeText(data.redirectUri)}>{tKey('dash.spotify.copy')}</Button>
        </div>
        <div className="sp-row">
          <Button variant="primary" onClick={() => void connect()}>{tKey('dash.spotify.connect')}</Button>
          <Button onClick={configure}>{tKey('dash.spotify.clientId')}</Button>
        </div>
        <p className="sp-note">{tKey('dash.spotify.waiting')}</p>
        {error && <p className="sp-error">{error}</p>}
      </div>
    );
  }

  const premium = data.premium;
  const base = data.player;
  const player: Player | undefined = base && { ...base, ...opt };
  const track = player?.track;
  const progress = player ? (player.playing ? Math.min(track?.durationMs ?? 0, player.progressMs + (Date.now() - since)) : player.progressMs) : 0;
  const duration = track?.durationMs ?? 0;
  const lock = !premium;

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (lock || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const positionMs = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration);
    void act('seek', { positionMs }, { progressMs: positionMs });
  };
  const commitVolume = (percent: number) => void act('volume', { percent });
  const transfer = (d: Device) => void act('transfer', { deviceId: d.id, play: true });
  const playTrack = (uri: string) => void act('play-uri', { uri });

  const rows = (tab === 'recent' ? data.recent : data.playlists).map((item): ListRow => {
    const isTrack = 'artists' in item;
    return {
      id: `${tab}:${item.uri}`,
      title: item.name,
      meta: [isTrack ? item.artists : item.owner],
      trailing: isTrack ? fmtClock(item.durationMs) : String(item.tracks),
      menu: () => {
        const [, kind, sid] = item.uri.split(':');
        return [
          { id: 'play', label: tKey('dash.spotify.play'), icon: 'play' as const, disabled: lock, run: () => playTrack(item.uri) },
          ...(isTrack ? [{ id: 'queue', label: tKey('dash.spotify.queue'), icon: 'plus' as const, disabled: lock, run: () => void act('queue', { uri: item.uri }) }] : []),
          ...(sid ? ['sep' as const, { id: 'copy-link', label: tKey('dash.spotify.copyLink'), icon: 'copy' as const, run: () => void copyNotify(`https://open.spotify.com/${kind}/${sid}`) }] : []),
        ];
      },
      status: (
        <span className="sp-row-actions">
          <Button size="xs" disabled={lock} title={tKey('dash.spotify.play')} onClick={() => playTrack(item.uri)}>{tKey('dash.spotify.play')}</Button>
          {isTrack && <Button size="xs" disabled={lock} onClick={() => void act('queue', { uri: item.uri })}>{tKey('dash.spotify.queue')}</Button>}
        </span>
      ),
    };
  });

  return (
    <div className="sp">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      <div className="sp-head">
        <Chip tone={premium ? 'ok' : 'neutral'}>{tKey(premium ? 'dash.spotify.premium' : 'dash.spotify.free')}</Chip>
        <span className="sp-user">{data.user}</span>
        <Button size="xs" variant="ghost" onClick={() => void act('disconnect')}>{tKey('dash.spotify.disconnect')}</Button>
      </div>
      {lock && <p className="sp-note">{tKey('dash.spotify.premiumRequired')}</p>}
      {!player ? (
        <div className="sp-idle">
          <p className="sp-note">{tKey('dash.spotify.noDevice')}</p>
          {data.devices.length === 0 ? (
            <p className="sp-note">{tKey('dash.spotify.noDevices')}</p>
          ) : (
            <ul className="sp-devices">
              {data.devices.map((d) => (
                <li
                  key={d.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ at: { x: e.clientX, y: e.clientY }, items: [{ id: 'transfer', label: tKey('dash.spotify.transfer'), icon: 'play', disabled: lock, run: () => transfer(d) }] });
                  }}
                >
                  <span>{d.name} <span className="sp-sub">{d.type}</span></span>
                  <Button size="xs" disabled={lock} onClick={() => transfer(d)}>{tKey('dash.spotify.transfer')}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="sp-now">
            {track?.image ? <img className="sp-art" src={track.image} alt="" /> : <div className="sp-art" />}
            <div className="sp-meta">
              <strong className="sp-title" title={track?.name}>{track?.name ?? tKey('dash.spotify.nothing')}</strong>
              <span className="sp-sub" title={track?.artists}>{track?.artists}</span>
              <span className="sp-sub">{track?.album}</span>
            </div>
          </div>
          <div className="sp-progress">
            <span className="sp-time">{fmtClock(progress)}</span>
            <div className={`sp-bar${lock ? ' sp-bar--locked' : ''}`} onClick={seek} role="progressbar" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={progress}>
              <div className="sp-bar-fill" style={{ width: `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }} />
            </div>
            <span className="sp-time">{fmtClock(duration)}</span>
          </div>
          <div className="sp-controls">
            <Button size="sm" disabled={lock} pressed={player.shuffle} title={tKey('dash.spotify.shuffle')} onClick={() => void act('shuffle', { state: !player.shuffle }, { shuffle: !player.shuffle })}>⇄</Button>
            <Button size="sm" disabled={lock} title={tKey('dash.spotify.previous')} onClick={() => void act('previous')}>⏮</Button>
            <Button size="sm" variant="primary" disabled={lock} title={tKey(player.playing ? 'dash.spotify.pause' : 'dash.spotify.play')} onClick={() => void act(player.playing ? 'pause' : 'play', undefined, { playing: !player.playing })}>
              {player.playing ? '⏸' : '▶'}
            </Button>
            <Button size="sm" disabled={lock} title={tKey('dash.spotify.next')} onClick={() => void act('next')}>⏭</Button>
            <Button size="sm" disabled={lock} pressed={player.repeat !== 'off'} title={tKey(`dash.spotify.repeat.${player.repeat}`)} onClick={() => void act('repeat', { state: nextRepeat(player.repeat) }, { repeat: nextRepeat(player.repeat) })}>
              {player.repeat === 'track' ? '↻1' : '↻'}
            </Button>
          </div>
          <div className="sp-row sp-row--mix">
            <span className="sp-vol">
              <span className="sp-vol-icon" aria-hidden="true">{player.volume === 0 ? '🔇' : player.volume < 50 ? '🔉' : '🔊'}</span>
              <input
                className="sp-volume"
                type="range"
                min={0}
                max={100}
                value={player.volume}
                style={{ '--sp-fill': `${player.volume}%` } as React.CSSProperties}
                disabled={lock}
                aria-label={tKey('dash.spotify.volume')}
                title={`${player.volume}%`}
                onChange={(e) => setOpt((o) => ({ ...o, volume: Number(e.target.value) }))}
                onPointerUp={(e) => commitVolume(Number(e.currentTarget.value))}
                onKeyUp={(e) => commitVolume(Number(e.currentTarget.value))}
              />
              <span className="sp-vol-pct">{player.volume}%</span>
            </span>
            <select
              className="sp-device"
              value={player.device?.id ?? ''}
              disabled={lock}
              aria-label={tKey('dash.spotify.device')}
              onChange={(e) => {
                const d = data.devices.find((x) => x.id === e.target.value);
                if (d) transfer(d);
              }}
            >
              {data.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </>
      )}
      {error && <p className="sp-error">{error}</p>}
      <div className="sp-tabs">
        <Button size="xs" pressed={tab === 'recent'} onClick={() => setTab('recent')}>{tKey('dash.spotify.recent')}</Button>
        <Button size="xs" pressed={tab === 'playlists'} onClick={() => setTab('playlists')}>{tKey('dash.spotify.playlists')}</Button>
      </div>
      <ListRows rows={rows} empty={tKey(tab === 'recent' ? 'dash.spotify.recent.empty' : 'dash.spotify.playlists.empty')} />
    </div>
  );
}
