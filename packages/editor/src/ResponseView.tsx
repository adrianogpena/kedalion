import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { type ApiError, Badge, Button, CopyButton, ErrorBanner, formatBytes, Icon, JsonTree, PanelBanner, PanelNotice, Spinner, t } from '@kedalion/ui';
import { useMemo, useState } from 'react';
import { CodeView } from './CodeView';
import { ResponseDiffStrip } from './ResponseDiffStrip';
import { bodyView, formatMs, statusTone } from './http';

export interface ResponseViewProps {
  response?: HttpResponseInfo;
  error?: ApiError;
  sending?: boolean;
  onSave?(): void;
  /** Pinned response to diff against; the Live | Diff pair and Pin button show only when `onPin` is given. */
  baseline?: HttpResponseInfo;
  view?: 'live' | 'diff';
  onView?(view: 'live' | 'diff'): void;
  /** Pins the current response, or unpins when already pinned. */
  onPin?(): void;
}

/** Status line, body (JSON tree, text or a binary notice) and headers of one HTTP response. */
export function ResponseView({ response, error, sending, onSave, baseline, view, onView, onPin }: ResponseViewProps) {
  if (sending && !response) return <div className="resp-empty"><Spinner /></div>;
  if (error) return <div className="resp"><ErrorBanner error={error} /></div>;
  if (!response) {
    return <PanelNotice icon={<Icon name="send" size={20} />} title={t('http.noResponse')} message={t('http.noResponseMessage')} />;
  }
  return <ResponseBody response={response} sending={sending} onSave={onSave} baseline={baseline} view={view} onView={onView} onPin={onPin} />;
}

function ResponseBody({ response, sending, onSave, baseline, view, onView, onPin }: Omit<ResponseViewProps, 'error'> & { response: HttpResponseInfo }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const diffing = !!onPin && view === 'diff' && !!baseline;
  return (
    <div className="resp">
      {onPin && (
        <div className="resp-status">
          <span className="mono-label">{t('http.response')}</span>
          <Button size="xs" variant="ghost" pressed={!diffing} onClick={() => onView?.('live')}>{t('http.live')}</Button>
          <Button size="xs" variant="ghost" pressed={diffing} disabled={!baseline} title={baseline ? t('http.diff') : t('http.noBaseline')} onClick={() => onView?.('diff')}>{t('http.diff')}</Button>
          <span className="spacer" />
          <Button size="xs" variant="ghost" icon="pin" pressed={!!baseline} title={baseline ? t('http.unpin') : t('http.pin')} onClick={onPin}>{baseline ? t('http.pinned') : t('http.pin')}</Button>
        </div>
      )}
      <div className="resp-status">
        <Badge tone={statusTone(response.status)}>{`${response.status} ${response.statusText}`.trim()}</Badge>
        <span className="resp-meta" title={t('http.timing')}>{formatMs(response.ms)} / {formatMs(response.totalMs)}</span>
        <span className="resp-meta">{formatBytes(response.size)}</span>
        {response.redirected && <span className="resp-meta resp-url" title={response.url}>{response.url}</span>}
        <span className="spacer" />
        {sending && <Spinner small />}
        {onSave && (
          <Button title={t('http.save')} size="sm" icon="download" onClick={onSave}>{t('http.save')}</Button>
        )}
      </div>
      {response.truncated && <PanelBanner tone="warn" icon="alert">{t('http.truncated', { size: formatBytes(response.size) })}</PanelBanner>}
      {diffing && baseline ? (
        <div className="resp-panel"><ResponseDiffStrip baseline={baseline} live={response} dim={sending} /></div>
      ) : (
        <>
          <div className="req-tabs" role="tablist">
            {(['body', 'headers'] as const).map((id) => (
              <button title={t(`http.tab.${id}`)} key={id} role="tab" aria-selected={tab === id} className={`req-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
                {t(`http.tab.${id}`)}
                {id === 'headers' && <span className="req-tab-count">{response.headers.length}</span>}
              </button>
            ))}
          </div>
          <div className="resp-panel">
            {tab === 'body' ? <BodyPane response={response} /> : <HeadersPane headers={response.headers} />}
          </div>
        </>
      )}
    </div>
  );
}

function BodyPane({ response }: { response: HttpResponseInfo }) {
  const view = useMemo(() => bodyView(response), [response]);
  const [raw, setRaw] = useState(false);
  if (view.kind === 'binary') return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('http.binary')} />;
  if (view.kind === 'text') return <div className="resp-body"><CodeView value={view.text} lang={view.lang} lineNumbers /></div>;
  return (
    <>
      <div className="file-preview-bar">
        <Button title={raw ? t('http.tree') : t('http.raw')} variant="ghost" size="sm" onClick={() => setRaw(!raw)} pressed={raw}>{raw ? t('http.tree') : t('http.raw')}</Button>
        <CopyButton text={view.pretty} />
      </div>
      <div className="resp-body">
        {raw ? <CodeView value={view.pretty} lang="json" lineNumbers /> : <JsonTree value={view.value} />}
      </div>
    </>
  );
}

function HeadersPane({ headers }: { headers: Array<[string, string]> }) {
  return (
    <>
      <div className="file-preview-bar">
        <CopyButton text={headers.map(([name, value]) => `${name}: ${value}`).join('\n')} label={t('http.copyAll')} />
      </div>
      <div className="resp-body">
        <table className="resp-headers">
          <thead><tr><th>{t('http.headerName')}</th><th>{t('http.headerValue')}</th></tr></thead>
          <tbody>
            {headers.map(([name, value], i) => <tr key={i}><td>{name}</td><td>{value}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
