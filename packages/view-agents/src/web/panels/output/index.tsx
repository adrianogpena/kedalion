import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, request, stream } from '@kedalion/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps } from '../../workspace/types';
import { lineText, parseLines, splitHits, stripAnsi } from './ansi';
import './style.css';

const POLL_MS = 1000;
const STICK_PX = 24;

type Status = 'running' | 'done' | 'error';

interface OutputRun {
  command: string;
  status: Status;
  output: string;
  truncated: boolean;
  toolUseId: string;
  background: boolean;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
}

interface RunSummary {
  toolUseId: string;
  command: string;
  background: boolean;
  status: Status;
}

interface Payload {
  run: OutputRun | null;
  runs: RunSummary[];
  live: boolean;
  hook: string;
}

const hookSnippet = (hook: string) => JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hook }] }] } }, null, 2);

/** The server's payload for the session, pushed over a stream; polled instead when the stream fails. */
function usePayload(project: string | undefined, sessionId: string | undefined, pin: string | undefined, visible: boolean): Payload | undefined {
  const [payload, setPayload] = useState<Payload>();
  useEffect(() => {
    setPayload(undefined);
    if (!project || !visible) return;
    const params = { project, sessionId, toolUseId: pin };
    const abort = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = () => {
      if (timer) return;
      const load = () => void request<Payload>('GET', '/api/agents/output', params).then((p) => !abort.signal.aborted && setPayload(p), () => undefined);
      load();
      timer = setInterval(load, POLL_MS);
    };
    stream('/api/agents/output/stream', params, (item) => setPayload(item as Payload), abort.signal).then(
      () => !abort.signal.aborted && poll(),
      () => !abort.signal.aborted && poll(),
    );
    return () => {
      abort.abort();
      if (timer) clearInterval(timer);
    };
  }, [project, sessionId, pin, visible]);
  return payload;
}

const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

function OutputBody({ project, sessionId, visible = true, initialPin }: { project: string | undefined; sessionId?: string; visible?: boolean; initialPin?: string }) {
  const [pin, setPin] = useState<string | undefined>(initialPin);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState('');
  const [cleared, setCleared] = useState<string>();
  const [copied, setCopied] = useState<'out' | 'hook'>();
  const [now, setNow] = useState(Date.now());
  const payload = usePayload(project, sessionId, pin, visible);
  const run = payload?.run;
  const pre = useRef<HTMLPreElement>(null);
  const stuck = useRef(true);

  useEffect(() => {
    setPin(initialPin);
    setCleared(undefined);
  }, [project, sessionId, initialPin]);

  const running = run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const id = run?.toolUseId;
  useEffect(() => {
    stuck.current = true;
  }, [id]);

  const hidden = run !== null && run !== undefined && cleared === run.toolUseId;
  const text = hidden ? '' : run?.output ?? '';
  const lines = useMemo(() => parseLines(text), [text]);
  const shown = useMemo(() => (query ? lines.filter((l) => lineText(l).toLowerCase().includes(query.toLowerCase())) : lines), [lines, query]);

  useLayoutEffect(() => {
    const el = pre.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [text, id, shown]);

  const flash = (what: 'out' | 'hook', value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(undefined), 1500);
    }, () => undefined);
  };

  if (!project) return <p className="agents-empty agents-placeholder">{t('panel.output.noProject')}</p>;
  if (!payload) return <div className="agents-output" />;

  const hint = !payload.live && (!run || (running && !run.background)) && (
    <div className="agents-output-note">
      {t('panel.output.liveHint')}{' '}
      <Button size="xs" icon="copy" onClick={() => flash('hook', hookSnippet(payload.hook))}>{copied === 'hook' ? t('panel.output.copied') : t('panel.output.copySnippet')}</Button>
    </div>
  );
  if (!run) {
    return (
      <div className="agents-output">
        <p className="agents-empty agents-placeholder">{t('panel.output.empty')}</p>
        {hint}
      </div>
    );
  }

  const end = run.endedAt ?? (running ? now : undefined);
  const elapsed = run.startedAt !== undefined && end !== undefined ? fmtElapsed(end - run.startedAt) : undefined;
  const lineCount = text ? lines.length : 0;
  const meta = [elapsed, lineCount > 0 ? t('panel.output.lines', { n: lineCount }) : undefined, run.exitCode !== undefined && run.status !== 'running' ? t('panel.output.exit', { code: run.exitCode }) : undefined].filter(Boolean).join(' · ');
  const label = (r: RunSummary) => `${r.background ? `[${t('panel.output.background')}] ` : ''}${r.command.replace(/\s+/g, ' ').slice(0, 80)}`;

  return (
    <div className="agents-output">
      <div className="agents-output-head">
        <code className="agents-output-cmd" title={run.command}>{run.command}</code>
        {meta && <span className="agents-output-meta">{meta}</span>}
        <span className="agents-output-status" data-status={run.status}>{t(`panel.output.${run.status}`)}</span>
      </div>
      <div className="agents-output-bar">
        <select aria-label={t('panel.output.history')} value={pin ?? ''} onChange={(e) => setPin(e.target.value || undefined)}>
          <option value="">{t('panel.output.latest')}</option>
          {payload.runs.map((r) => <option key={r.toolUseId} value={r.toolUseId}>{`${t(`panel.output.${r.status}`)} · ${label(r)}`}</option>)}
        </select>
        <input type="search" value={query} placeholder={t('panel.output.filter')} aria-label={t('panel.output.filter')} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="ghost" size="xs" pressed={wrap} onClick={() => setWrap((w) => !w)}>{t('panel.output.wrap')}</Button>
        <Button variant="ghost" size="xs" icon="copy" onClick={() => flash('out', stripAnsi(run.output))}>{copied === 'out' ? t('panel.output.copied') : t('panel.output.copy')}</Button>
        <Button variant="ghost" size="xs" onClick={() => setCleared(run.toolUseId)}>{t('panel.output.clear')}</Button>
      </div>
      {run.truncated && !hidden && <div className="agents-output-note">{t('panel.output.truncated')}</div>}
      {hint}
      <pre
        ref={pre}
        className="agents-output-pre"
        data-wrap={wrap ? 'on' : 'off'}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
        }}
      >
        {text ? (
          shown.length ? (
            shown.map((line, i) => (
              <Fragment key={i}>
                {line.map((s, j) => (
                  <span key={j} className={s.cls || undefined}>
                    {splitHits(s.text, query).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text))}
                  </span>
                ))}
                {'\n'}
              </Fragment>
            ))
          ) : (
            t('panel.output.noMatch')
          )
        ) : hidden || running ? '' : t('panel.output.noOutput')}
      </pre>
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'output',
  titleKey: 'panel.output.title',
  icon: 'terminal',
  placement: 'both',
  single: true,
  Panel: ({ project, visible, sessionId, params }: PanelProps) => (
    <div className="agents-panel-output">
      <OutputBody project={project} sessionId={sessionId} visible={visible} initialPin={typeof params.toolUseId === 'string' && params.toolUseId ? params.toolUseId : undefined} />
    </div>
  ),
  Section: ({ project, sessionId }: SectionProps) => <OutputBody project={project} sessionId={sessionId} />,
};
