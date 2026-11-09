import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, copyNotify, errorMessage, errorOf, IconButton, LogView, request, useViewLink, type LogLine, type SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { detectLevel } from '../pods/logs';
import type { ContainersConfig, Verb } from './ContainersPanel';
import { parseLogFiles, relativeIn, setLogFile, type Container } from './model';
import './containers.css';

const POLL_MS = 3000;

const describe = (err: unknown): string => {
  const e = errorOf(err);
  return [errorMessage(e), e.detail].filter(Boolean).join(': ');
};

/** Log lines that reload every few seconds from `load`. */
function PolledLogs({ load, deps, footer }: { load(): Promise<string[]>; deps: readonly unknown[]; footer?: ReactNode }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const raw = await load();
      setLines(
        raw.map((text, n): LogLine => {
          const level = detectLevel(text);
          return { n, offset: 0, text, level, own: level !== null };
        }),
      );
      setError('');
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoaded(true);
    }
  }, deps);

  useEffect(() => {
    setLoaded(false);
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <div className="container-logs">
      <div className="container-logs-view">
        {loaded && lines.length === 0 && !error ? (
          <p className="kit-empty">{tKey('dash.containers.logs.empty')}</p>
        ) : (
          <LogView lines={lines} highlights={[]} onHighlightsChange={() => {}} follow={follow} onFollowChange={setFollow} />
        )}
      </div>
      <div className="container-logs-foot">
        <span className="container-logs-status">{error}</span>
        {footer}
        <Button icon="refresh" onClick={() => void reload()}>{tKey('dash.containers.logs.refresh')}</Button>
      </div>
    </div>
  );
}

function EngineLogsTab({ name, config }: { name: string; config: ContainersConfig }) {
  const load = async () => (await runAction<{ lines: string[] }>('containers', 'logs', config, { name })).lines;
  return <PolledLogs load={load} deps={[name, config.engine]} />;
}

interface ProjectRef {
  id: string;
  path: string;
}

/** The Explorer project that holds `file` (the deepest one) and the path inside it. */
function explorerTarget(projects: readonly ProjectRef[], file: string): { project: string; path: string } | null {
  let best: { project: string; path: string; depth: number } | null = null;
  for (const p of projects) {
    const rel = relativeIn(p.path, file);
    if (rel !== null && (!best || p.path.length > best.depth)) best = { project: p.id, path: rel, depth: p.path.length };
  }
  return best && { project: best.project, path: best.path };
}

interface LocalProps {
  name: string;
  config: ContainersConfig;
  getConfig(): ContainersConfig;
  setConfig?(next: ContainersConfig): void;
}

function LocalLogsTab({ name, config, getConfig, setConfig }: LocalProps) {
  const [path, setPath] = useState(() => parseLogFiles(getConfig().logFiles ?? '')[name] ?? '');
  const [draft, setDraft] = useState(path);
  const [editing, setEditing] = useState(!path);
  const linkExplorer = useViewLink<{ project: string; path: string; open: boolean }>('explorer');
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const hasLink = !!linkExplorer;

  useEffect(() => {
    if (!hasLink) return;
    request<ProjectRef[]>('GET', '/api/projects').then(setProjects, () => setProjects([]));
  }, [hasLink]);

  const inExplorer = useMemo(() => (path ? explorerTarget(projects, path) : null), [projects, path]);

  const save = (next: string) => {
    const clean = next.trim();
    const current = getConfig();
    setConfig?.({ ...current, logFiles: setLogFile(current.logFiles ?? '', name, clean) });
    setPath(clean);
    setDraft(clean);
    setEditing(!clean);
  };

  if (editing) {
    return (
      <div className="container-localpath">
        <label className="field">
          <span className="mono-label">{tKey('dash.containers.localLogs.path')}</span>
          <input
            value={draft}
            placeholder="X:\path\to\file.log"
            maxLength={1000}
            spellCheck={false}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) save(draft);
              if (e.key === 'Escape' && path) setEditing(false);
            }}
          />
          <span className="muted">{tKey('dash.containers.localLogs.hint')}</span>
        </label>
        <div className="container-localpath-actions">
          <Button variant="primary" disabled={!draft.trim() || !setConfig} onClick={() => save(draft)}>
            {tKey('dash.containers.localLogs.save')}
          </Button>
          {path && (
            <Button
              onClick={() => {
                setDraft(path);
                setEditing(false);
              }}
            >
              {tKey('dash.containers.localLogs.cancel')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const load = async () => (await runAction<{ lines: string[] }>('containers', 'file-logs', config, { path })).lines;
  return (
    <PolledLogs
      load={load}
      deps={[path]}
      footer={
        <>
          <span className="container-logs-path" title={path}>{path}</span>
          {linkExplorer && inExplorer && (
            <Button icon="file" onClick={() => linkExplorer({ ...inExplorer, open: true })}>
              {tKey('dash.containers.localLogs.openExplorer')}
            </Button>
          )}
          <IconButton icon="edit" label={tKey('dash.containers.localLogs.edit')} onClick={() => setEditing(true)} />
          {setConfig && <IconButton icon="trash" label={tKey('dash.containers.localLogs.remove')} onClick={() => save('')} />}
        </>
      }
    />
  );
}

export interface ContainerSideInput {
  instanceId: string;
  container: Container;
  config: ContainersConfig;
  /** The panel's current config; the side panel keeps its first render, so saves read this. */
  getConfig(): ContainersConfig;
  setConfig?(next: ContainersConfig): void;
  run(verb: Verb, name: string): Promise<void>;
}

/** What the Containers panel opens in the Dashboard side panel for one container. */
export function containerSideContent({ instanceId, container: c, config, getConfig, setConfig, run }: ContainerSideInput): SidePanelContent {
  return {
    id: `${instanceId}:${c.name}`,
    title: c.name,
    subtitle: c.image,
    icon: 'cube',
    tabs: [
      { id: 'logs', label: tKey('dash.containers.logs'), render: () => <EngineLogsTab name={c.name} config={config} /> },
      {
        id: 'local-logs',
        label: tKey('dash.containers.localLogs'),
        render: () => <LocalLogsTab name={c.name} config={config} getConfig={getConfig} setConfig={setConfig} />,
      },
    ],
    actions: (
      <>
        <IconButton icon="rotate-ccw" label={tKey('dash.containers.restart')} onClick={() => void run('restart', c.name)} />
        <IconButton icon="copy" label={tKey('dash.containers.copyName')} onClick={() => void copyNotify(c.name)} />
      </>
    ),
  };
}
