import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, ContextMenu, copyNotify, errorMessage, errorOf, Icon, IconButton } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip, relTime } from '../../kit';
import { requestRefresh, type PanelSide } from '../../panel';
import { runAction } from '../../source';
import { containerSideContent } from './ContainerSide';
import { containerTone, togglePinned, type Container } from './model';
import './containers.css';

export interface ContainersConfig {
  engine: string;
  pinned: string;
  logFiles: string;
  showStopped: boolean;
  [key: string]: unknown;
}

export interface ContainersPanelData {
  machineDown: boolean;
  engine: 'podman' | 'docker';
  containers: Container[];
}

export type Verb = 'start' | 'stop' | 'restart';

interface Props {
  id: string;
  config: ContainersConfig;
  data: ContainersPanelData | undefined;
  refresh(): void;
  side?: PanelSide;
  setConfig?(next: ContainersConfig): void;
}

const FOLLOW_UP_MS = [1500, 4000, 8000];
const KNOWN_STATES = new Set(['running', 'exited', 'paused', 'restarting', 'created', 'dead']);

function describe(err: unknown): string {
  const e = errorOf(err);
  return [errorMessage(e), e.detail].filter(Boolean).join(': ');
}

function stateLabel(c: Container): string {
  if (/unhealthy/i.test(c.status)) return tKey('dash.containers.state.unhealthy');
  const s = c.state.toLowerCase();
  return KNOWN_STATES.has(s) ? tKey(`dash.containers.state.${s}` as 'dash.containers.state.running') : c.state || '?';
}

function ErrorLine({ message, onDismiss }: { message: string; onDismiss(): void }) {
  return (
    <div className="containers-error-row">
      <p className="containers-error">{message}</p>
      <IconButton icon="close" size="xs" label={tKey('dash.containers.dismiss')} onClick={onDismiss} />
    </div>
  );
}

export function ContainersPanel({ id, config, data, refresh, side, setConfig }: Props) {
  const [busy, setBusy] = useState<Record<string, Verb>>({});
  const [machineBusy, setMachineBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; c: Container } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!data) return null;

  const settle = () => {
    refresh();
    timers.current.forEach(clearTimeout);
    timers.current = FOLLOW_UP_MS.map((ms) => setTimeout(refresh, ms));
  };

  const run = async (verb: Verb, name: string) => {
    setBusy((b) => ({ ...b, [name]: verb }));
    setError('');
    try {
      await runAction('containers', verb, config, { name });
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== name)));
      settle();
      requestRefresh('containers');
    }
  };

  const startMachine = async () => {
    setMachineBusy(true);
    setError('');
    try {
      await runAction('containers', 'machine-start', config);
    } catch (err) {
      setError(describe(err));
    } finally {
      setMachineBusy(false);
      settle();
    }
  };

  if (data.machineDown) {
    return (
      <div className="containers-down">
        <p className="kit-empty">{tKey(data.engine === 'podman' ? 'dash.containers.machineDown' : 'dash.containers.engineDown')}</p>
        {data.engine === 'podman' && (
          <Button disabled={machineBusy} onClick={() => void startMachine()}>
            {tKey('dash.containers.machineStart')}
          </Button>
        )}
        {error && <ErrorLine message={error} onDismiss={() => setError('')} />}
      </div>
    );
  }

  const rows = data.containers.filter((c) => config.showStopped || c.state === 'running');
  if (rows.length === 0) return <p className="kit-empty">{tKey('dash.containers.empty')}</p>;

  const content = (c: Container) => containerSideContent({ instanceId: id, container: c, config, getConfig: () => configRef.current, setConfig, run });
  const toggle = (c: Container) => {
    if (!side) return;
    const sc = content(c);
    if (side.isOpen(sc.id)) side.close();
    else side.open(sc);
  };
  const openMenu = (e: MouseEvent, c: Container) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, c });
  };
  const onKey = (e: KeyboardEvent, c: Container) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(c);
    }
  };

  const items = (c: Container) => {
    const running = c.state === 'running';
    return [
      running
        ? { id: 'stop', label: tKey('dash.containers.stop'), icon: 'square' as const, run: () => void run('stop', c.name) }
        : { id: 'start', label: tKey('dash.containers.start'), icon: 'play' as const, run: () => void run('start', c.name) },
      { id: 'restart', label: tKey('dash.containers.restart'), icon: 'rotate-ccw' as const, danger: true, run: () => void run('restart', c.name) },
      ...(side ? [{ id: 'logs', label: tKey('dash.containers.logs'), icon: 'log' as const, run: () => side.open(content(c), 'logs') }] : []),
      { id: 'copy', label: tKey('dash.containers.copyName'), icon: 'copy' as const, run: () => void copyNotify(c.name) },
      { id: 'copyId', label: tKey('dash.containers.copyId'), icon: 'copy' as const, run: () => void copyNotify(c.id) },
      ...(setConfig
        ? [
            {
              id: 'pin',
              label: tKey(c.pinned ? 'dash.containers.unpin' : 'dash.containers.pin'),
              icon: 'pin' as const,
              run: () => setConfig({ ...configRef.current, pinned: togglePinned(configRef.current.pinned ?? '', c.name) }),
            },
          ]
        : []),
    ];
  };

  return (
    <div className="containers">
      {error && <ErrorLine message={error} onDismiss={() => setError('')} />}
      <ul className="containers-list">
        {rows.map((c) => {
          const running = c.state === 'running';
          const verb = busy[c.name];
          const selected = !!side && side.isOpen(content(c).id);
          const sub = [c.image, c.status, c.ports, c.created ? relTime(c.created) : ''].filter(Boolean);
          return (
            <li
              key={c.name}
              className={`containers-row${selected ? ' containers-row--selected' : ''}`}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              onClick={() => toggle(c)}
              onKeyDown={(e) => onKey(e, c)}
              onContextMenu={(e) => openMenu(e, c)}
            >
              <div className="containers-main">
                <Chip tone={verb ? 'info' : containerTone(c)}>{verb ? tKey(`dash.containers.busy.${verb}` as 'dash.containers.busy.start') : stateLabel(c)}</Chip>
                {c.pinned && <Icon name="pin" size={12} />}
                <span className="containers-name" title={c.name}>{c.name}</span>
                <IconButton
                  icon={running ? 'square' : 'play'}
                  label={tKey(running ? 'dash.containers.stop' : 'dash.containers.start')}
                  disabled={!!verb}
                  onClick={(e) => {
                    e.stopPropagation();
                    void run(running ? 'stop' : 'start', c.name);
                  }}
                />
                <IconButton icon="more" label={tKey('dash.containers.menu')} onClick={(e) => openMenu(e, c)} />
              </div>
              {sub.length > 0 && <div className="containers-sub" title={sub.join(' · ')}>{sub.join(' · ')}</div>}
            </li>
          );
        })}
      </ul>
      {menu && <ContextMenu at={menu.at} items={items(menu.c)} onClose={() => setMenu(null)} />}
    </div>
  );
}
