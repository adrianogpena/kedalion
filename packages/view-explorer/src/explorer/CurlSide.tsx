import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor, type CurlCommand, type CurlItem, curlAt, curlBodyRange, curlNotes, curlOutline, curlVariables, DEFAULT_FORMAT_OPTIONS, exportCurl, type CurlExportFormat, formatSql, formatXml, type ImportedRequest, parseCurl, quoteCurlBody, variableClass, variableHighlight, variableInfo } from '@kedalion/editor';
import { restVarRefs, type RestEnvVar } from '@kedalion/server-core/protocol';
import { Button, copyNotify, Icon, IconButton, Tabs } from '@kedalion/ui';
import { t } from '../i18n';

type SideTab = 'requests' | 'request' | 'vars';

export interface CurlSideProps {
  text: string;
  /** Cursor offset in `text`. */
  cursor: number;
  vars: readonly RestEnvVar[];
  envName?: string;
  onJump(from: number, to: number): void;
  onRun(): void;
  onOpenRest?(): void;
  /** Replaces `from..to` of the file with `text` (the edited body, already quoted). */
  onBody(from: number, to: number, text: string): void;
  /** Adds or sets `name` in the active environment; absent when none is active. */
  onSetVar?(name: string, value: string): Promise<void>;
  onClose(): void;
}

/** `{{var}}` references in `text` coloured by whether the active environment defines them. */
function WithVars({ text, vars }: { text: string; vars: readonly RestEnvVar[] }): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const ref of restVarRefs(text)) {
    out.push(text.slice(at, ref.from));
    const info = variableInfo(ref.name, vars);
    out.push(<span key={ref.from} className={variableClass(info.defined)} title={info.title}>{text.slice(ref.from, ref.to)}</span>);
    at = ref.to;
  }
  out.push(text.slice(at));
  return out;
}

const Method = ({ method }: { method: string }) => <span className={`xp-m xp-m-${method}`}>{method}</span>;

interface Folder {
  key: string;
  name: string;
  folders: Map<string, Folder>;
  items: CurlItem[];
}

function buildTree(items: CurlItem[]): Folder {
  const root: Folder = { key: '', name: '', folders: new Map(), items: [] };
  for (const item of items) {
    let node = root;
    for (const part of item.folder) {
      let next = node.folders.get(part);
      if (!next) {
        next = { key: `${node.key}/${part}`, name: part, folders: new Map(), items: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.items.push(item);
  }
  return root;
}

function Requests({ items, cursor, onJump }: { items: CurlItem[]; cursor: number; onJump: CurlSideProps['onJump'] }) {
  const [filter, setFilter] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(items), [items]);
  const needle = filter.trim().toLowerCase();
  const current = items.find((i) => cursor >= i.from && cursor <= i.to);
  const row = (item: CurlItem, depth: number, showFolder: boolean) => (
    <button
      key={item.from}
      type="button"
      className={`xp-curl-row${item === current ? ' active' : ''}`}
      style={{ paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-12))` }}
      title={`${item.method} ${item.url}`}
      onClick={() => onJump(item.from, item.from)}
    >
      <Method method={item.method} />
      <span className="xp-curl-name">{item.name}</span>
      {showFolder && item.folder.length > 0 && <span className="xp-curl-folder">{item.folder.join(' / ')}</span>}
    </button>
  );
  const folder = (node: Folder, depth: number): ReactNode[] => [
    ...[...node.folders.values()].flatMap((f) => {
      const open = !closed.has(f.key);
      return [
        <button
          key={f.key}
          type="button"
          className="xp-curl-row xp-curl-dir"
          style={{ paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-12))` }}
          aria-expanded={open}
          onClick={() => setClosed((c) => {
            const next = new Set(c);
            if (open) next.add(f.key);
            else next.delete(f.key);
            return next;
          })}
        >
          <Icon name={open ? 'chevron-down' : 'chevron'} size={12} />
          <span className="xp-curl-name">{f.name}</span>
        </button>,
        ...(open ? folder(f, depth + 1) : []),
      ];
    }),
    ...node.items.map((i) => row(i, depth, false)),
  ];
  const matches = needle ? items.filter((i) => `${i.folder.join(' ')} ${i.name} ${i.method} ${i.url}`.toLowerCase().includes(needle)) : [];
  return (
    <>
      <div className="xp-find">
        <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('explorer.curl.filter', { count: items.length })} spellCheck={false} />
      </div>
      <div className="xp-curl-list">
        {items.length === 0 ? <p className="muted xp-curl-empty">{t('explorer.curl.noRequests')}</p> : needle ? (matches.length ? matches.map((i) => row(i, 0, true)) : <p className="muted xp-curl-empty">{t('explorer.curl.noMatch')}</p>) : folder(tree, 0)}
      </div>
    </>
  );
}

const COPY_AS: Array<[CurlExportFormat, string]> = [['fetch', 'fetch'], ['powershell', 'PowerShell'], ['http', '.http']];

type BodyLang = 'json' | 'xml' | 'sql' | 'text';

const SQL_START = /^\s*(?:select|insert|update|delete|with|merge)\b/i;

function bodyLang(request: ImportedRequest): BodyLang {
  const { bodyLang: lang, body } = request.draft;
  if (lang === 'json' || lang === 'xml') return lang;
  return SQL_START.test(body) ? 'sql' : 'text';
}

/** Pretty-prints `text` for its language; null when it cannot (invalid JSON, no formatter). */
function formatBody(text: string, lang: BodyLang): string | null {
  if (lang === 'sql') return formatSql(text, DEFAULT_FORMAT_OPTIONS);
  if (lang === 'xml') {
    try {
      return formatXml(text);
    } catch {
      return null;
    }
  }
  if (lang !== 'json') return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function minifyBody(text: string, lang: BodyLang): string | null {
  if (lang === 'xml') {
    return text.replace(/>\s+</g, '><').trim();
  }
  if (lang !== 'json') return null;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The body of the request, edited in place: every change is written into the curl file. */
function BodyEditor({ request, command, vars, onBody }: { request: ImportedRequest; command: CurlCommand; vars: readonly RestEnvVar[]; onBody: CurlSideProps['onBody'] }) {
  const lang = bodyLang(request);
  const fileBody = request.draft.body;
  const range = useMemo(() => curlBodyRange(command.text), [command]);
  const [local, setLocal] = useState(fileBody);
  const sent = useRef(fileBody);
  useEffect(() => {
    if (fileBody === sent.current) return;
    sent.current = fileBody;
    setLocal(fileBody);
  }, [fileBody]);
  const extensions = useMemo(() => variableHighlight(vars), [vars]);
  const change = (next: string) => {
    setLocal(next);
    if (!range || next === sent.current) return;
    sent.current = next;
    onBody(command.from + range.from, command.from + range.to, quoteCurlBody(next));
  };
  const formatted = formatBody(local, lang);
  const minified = minifyBody(local, lang);
  return (
    <>
      <h4 className="xp-curl-h">
        {t('explorer.curl.body', { type: lang })}
        {!range && <span className="xp-curl-ro"> · {t('explorer.curl.bodyReadOnly')}</span>}
      </h4>
      {range && (formatted !== null || minified !== null) && (
        <div className="xp-curl-actions">
          {formatted !== null && <Button size="sm" disabled={formatted === local} onClick={() => change(formatted)}>{t('explorer.curl.formatBody')}</Button>}
          {minified !== null && <Button size="sm" disabled={minified === local} onClick={() => change(minified)}>{t('explorer.curl.minifyBody')}</Button>}
        </div>
      )}
      <div className="xp-curl-body">
        <CodeEditor key={command.from} value={local} lang={lang} readOnly={!range} onChange={change} height="100%" wrap extensions={extensions} />
      </div>
    </>
  );
}

function Card({ props, command }: { props: CurlSideProps; command: ReturnType<typeof curlAt> }) {
  const { text, vars } = props;
  const parsed = useMemo(() => {
    if (!command) return undefined;
    try {
      return parseCurl(command.text);
    } catch {
      return undefined;
    }
  }, [command]);
  if (!command || !parsed) return <p className="muted xp-curl-empty">{t('explorer.curl.notCurl')}</p>;
  const { draft } = parsed;
  const notes = curlNotes(text, command.from);
  const form = draft.bodyLang === 'form' || draft.bodyLang === 'multipart';
  return (
    <div className="xp-curl-card">
      <div className="xp-curl-line">
        <Method method={draft.method} />
        <span className="xp-curl-url mono"><WithVars text={draft.url} vars={vars} /></span>
      </div>
      <div className="xp-curl-actions">
        <Button size="sm" icon="play" onClick={props.onRun}>{t('explorer.shared.run')}</Button>
        {props.onOpenRest && <Button size="sm" icon="send" onClick={props.onOpenRest}>{t('explorer.curl.openRest')}</Button>}
      </div>
      <div className="xp-curl-actions">
        <span className="muted">{t('explorer.curl.copyAs')}</span>
        {COPY_AS.map(([format, label]) => (
          <Button key={format} size="sm" icon="copy" onClick={() => void copyNotify(exportCurl(parsed, format))}>{label}</Button>
        ))}
      </div>
      <h4 className="xp-curl-h">{t('explorer.curl.headers', { count: draft.headers.length })}</h4>
      <table className="xp-curl-table mono">
        <tbody>
          {draft.headers.map((h, i) => (
            <tr key={i} className={h.enabled ? undefined : 'off'}>
              <th>{h.name}</th>
              <td><WithVars text={h.value} vars={vars} /></td>
            </tr>
          ))}
          {parsed.auth && <tr><th>Authorization</th><td>{parsed.auth}</td></tr>}
          {notes.map((n, i) => <tr key={`n${i}`} className="off"><th colSpan={2}>{n}</th></tr>)}
        </tbody>
      </table>
      {form ? (
        <>
          <h4 className="xp-curl-h">{t('explorer.curl.body', { type: draft.bodyLang })}</h4>
          <table className="xp-curl-table mono">
            <tbody>{(draft.form ?? []).map((f, i) => <tr key={i}><th>{f.name}</th><td><WithVars text={f.value} vars={vars} /></td></tr>)}</tbody>
          </table>
        </>
      ) : draft.body !== '' && <BodyEditor request={parsed} command={command} vars={vars} onBody={props.onBody} />}
    </div>
  );
}

function Variables({ text, vars, envName, onSetVar }: { text: string; vars: readonly RestEnvVar[]; envName?: string; onSetVar?: CurlSideProps['onSetVar'] }) {
  const list = useMemo(() => curlVariables(text), [text]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  if (list.length === 0) return <p className="muted xp-curl-empty">{t('explorer.curl.noVars')}</p>;
  const missing = list.filter((v) => !variableInfo(v.name, vars).defined).length;
  return (
    <div className="xp-curl-list">
      <p className="muted xp-curl-vars-head">{envName ? t('explorer.curl.varsEnv', { env: envName, missing }) : t('explorer.curl.varsNoEnv')}</p>
      {list.map((v) => {
        const info = variableInfo(v.name, vars);
        const value = drafts[v.name] ?? '';
        const set = async () => {
          if (!onSetVar || value === '') return;
          setBusy(v.name);
          try {
            await onSetVar(v.name, value);
            setDrafts(({ [v.name]: _, ...rest }) => rest);
          } finally {
            setBusy('');
          }
        };
        return (
          <div key={v.name} className="xp-curl-var">
            <span className={variableClass(info.defined)} title={info.title}>{`{{${v.name}}}`}</span>
            <span className="muted xp-curl-count">×{v.count}</span>
            {info.defined ? <span className="muted xp-curl-val mono">{info.title.startsWith(`${v.name} = `) ? info.title.slice(v.name.length + 3) : ''}</span> : onSetVar && (
              <span className="xp-curl-set">
                <input className="input" value={value} placeholder={t('explorer.curl.varValue')} spellCheck={false} onChange={(e) => setDrafts({ ...drafts, [v.name]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void set()} />
                <Button size="sm" disabled={value === '' || busy === v.name} onClick={() => void set()}>{t('explorer.curl.varSet')}</Button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Side panel of a `.curl` file: its requests (outline), the request at the cursor (card) and the `{{variables}}` it uses. */
export function CurlSide(props: CurlSideProps) {
  const [tab, setTab] = useState<SideTab>('requests');
  const text = useDeferredValue(props.text);
  const items = useMemo(() => curlOutline(text), [text]);
  const command = useMemo(() => curlAt(props.text, props.cursor), [props.text, props.cursor]);
  const shared = props;
  return (
    <div className="xp-curl-side">
      <div className="xp-bar">
        <Tabs
          idPrefix="curl-side"
          active={tab}
          tabs={[
            { id: 'requests', label: t('explorer.curl.tabRequests', { count: items.length }) },
            { id: 'request', label: t('explorer.curl.tabRequest') },
            { id: 'vars', label: t('explorer.curl.tabVars') },
          ]}
          onChange={(id) => setTab(id as SideTab)}
        />
        <span className="spacer" />
        <IconButton icon="close" onClick={props.onClose} label={t('explorer.curl.closePanel')} />
      </div>
      {tab === 'requests' && <Requests items={items} cursor={props.cursor} onJump={props.onJump} />}
      {tab === 'request' && <Card props={shared} command={command} />}
      {tab === 'vars' && <Variables text={text} vars={props.vars} envName={props.envName} onSetVar={props.onSetVar} />}
    </div>
  );
}
