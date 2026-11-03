import { useEffect, useMemo, useState } from 'react';
import type { NetworkEntry } from '@kedalion/cdp';
import { Button, copyNotify, IconButton, request, Tabs } from '@kedalion/ui';
import { toCurl } from './curl';
import { t } from './i18n';
import { grepLines, sliceBody, splitMatches } from './netview';
import { decodeOperations, prettyBody } from './ops';

export interface NetworkDetailData {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  postData?: string;
  body?: string;
  base64?: boolean;
  truncated?: boolean;
}

type DetailTab = 'headers' | 'payload' | 'response' | 'timing';
const TABS: DetailTab[] = ['headers', 'payload', 'response', 'timing'];

function Highlighted({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  return (
    <>
      {splitMatches(text, needle).map((p, i) => (p.hit ? <mark key={i} className="net-hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function ResponseBody({ text, search }: { text: string; search: string }) {
  const [find, setFind] = useState('');
  const [index, setIndex] = useState(0);
  const slice = sliceBody(text, index);
  const grep = useMemo(() => grepLines(text, find.trim()), [text, find]);
  const needle = find.trim() || search;
  return (
    <>
      <div className="net-find">
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.network.findInBody')} placeholder={t('browser.network.findInBody')} value={find} onChange={(e) => setFind(e.target.value)} />
        {slice.count > 1 && (
          <>
            <IconButton icon="back" size="xs" label={t('browser.network.slicePrev')} disabled={slice.index === 0} onClick={() => setIndex(slice.index - 1)} />
            <span>{t('browser.network.slice', { i: slice.index + 1, n: slice.count })}</span>
            <IconButton icon="forward" size="xs" label={t('browser.network.sliceNext')} disabled={slice.index >= slice.count - 1} onClick={() => setIndex(slice.index + 1)} />
          </>
        )}
      </div>
      {find.trim() && (
        <>
          <div className="browser-pane-empty">{t('browser.network.findMatches', { n: grep.matches })}</div>
          <pre className="net-body"><Highlighted text={grep.lines.join('\n')} needle={find.trim()} /></pre>
        </>
      )}
      {!find.trim() && <pre className="net-body"><Highlighted text={slice.text} needle={needle} /></pre>}
    </>
  );
}

function Headers({ title, headers }: { title: string; headers: Record<string, string> }) {
  const names = Object.keys(headers).sort((a, b) => a.localeCompare(b));
  return (
    <section className="net-section">
      <h4>{title}</h4>
      {names.length === 0 ? (
        <div className="browser-pane-empty">{t('browser.network.none')}</div>
      ) : (
        <dl className="net-headers">
          {names.map((n) => (
            <div key={n} className="net-header">
              <dt>{n}</dt>
              <dd>{headers[n]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export interface NetworkDetailProps {
  tab: string;
  entry: NetworkEntry;
  /** Body search text of the list, highlighted in the bodies. */
  search?: string;
  onClose(): void;
}

export function NetworkDetail({ tab, entry, search = '', onClose }: NetworkDetailProps) {
  const [active, setActive] = useState<DetailTab>('headers');
  const [raw, setRaw] = useState(false);
  const [detail, setDetail] = useState<NetworkDetailData | null | undefined>();

  useEffect(() => {
    let stale = false;
    setDetail(undefined);
    request<{ detail: NetworkDetailData | null }>('GET', '/api/browser/network/detail', { tab, id: String(entry.id) })
      .then((r) => !stale && setDetail(r.detail))
      .catch(() => !stale && setDetail(null));
    return () => {
      stale = true;
    };
  }, [tab, entry.id, entry.done]);

  const response = useMemo(() => {
    if (!detail?.body) return null;
    const mime = entry.mime ?? '';
    if (detail.base64 && mime.startsWith('image/')) return <img className="net-image" alt={entry.url} src={`data:${mime};base64,${detail.body}`} />;
    if (detail.base64) return <div className="browser-pane-empty">{t('browser.network.binary')}</div>;
    return <ResponseBody key={entry.id} text={prettyBody(detail.body, entry.mime ?? detail.responseHeaders['content-type'] ?? '')} search={search} />;
  }, [detail, entry.mime, entry.url, entry.id, search]);

  const contentType = detail ? (Object.entries(detail.requestHeaders).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '') : '';
  const decoded = detail?.postData ? prettyBody(detail.postData, contentType) : '';
  const operations = useMemo(() => (detail?.postData ? decodeOperations(detail.postData) : []), [detail?.postData]);

  return (
    <div className="net-detail">
      <div className="net-detail-head">
        <IconButton icon="close" size="xs" label={t('browser.network.closeDetail')} onClick={onClose} />
        <IconButton
          icon="curl"
          size="xs"
          label={t('browser.network.copyCurl')}
          disabled={!detail}
          onClick={() => detail && void copyNotify(toCurl({ method: entry.method, url: entry.url, headers: detail.requestHeaders, ...(detail.postData !== undefined ? { body: detail.postData } : {}) }))}
        />
        <Tabs idPrefix="browser-net" active={active} onChange={(id) => setActive(id as DetailTab)} tabs={TABS.map((id) => ({ id, label: t(`browser.network.tab.${id}` as const) }))} />
      </div>
      <div className="net-detail-body" role="tabpanel" id={`browser-net-panel-${active}`} aria-labelledby={`browser-net-tab-${active}`}>
        {active === 'headers' && (
          <>
            <section className="net-section">
              <h4>{t('browser.network.general')}</h4>
              <dl className="net-headers">
                <div className="net-header"><dt>URL</dt><dd>{entry.url}</dd></div>
                <div className="net-header"><dt>{t('browser.network.col.method')}</dt><dd>{entry.method}</dd></div>
                <div className="net-header"><dt>{t('browser.network.col.status')}</dt><dd>{entry.failed ?? entry.status ?? ''}</dd></div>
              </dl>
            </section>
            {detail === undefined && <div className="browser-pane-empty">{t('browser.network.loading')}</div>}
            {detail === null && <div className="browser-pane-empty">{t('browser.network.noDetail')}</div>}
            {detail && <Headers title={t('browser.network.responseHeaders')} headers={detail.responseHeaders} />}
            {detail && <Headers title={t('browser.network.requestHeaders')} headers={detail.requestHeaders} />}
          </>
        )}
        {active === 'payload' &&
          (detail?.postData ? (
            <>
              <div className="net-find">
                <Button size="xs" onClick={() => void copyNotify(decoded)}>{t('browser.network.copyBody')}</Button>
                <Button size="xs" pressed={raw} onClick={() => setRaw(!raw)}>{t('browser.network.rawBody')}</Button>
              </div>
              {operations.length > 0 && !raw && (
                <section className="net-section">
                  <h4>{t('browser.network.operations')} ({operations.length})</h4>
                  <ol className="net-ops-list">
                    {operations.map((o, i) => (
                      <li key={i}>
                        <strong><Highlighted text={o.operation} needle={search} /></strong> <Highlighted text={o.args} needle={search} />
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <pre className="net-body"><Highlighted text={raw ? detail.postData : decoded} needle={search} /></pre>
            </>
          ) : (
            <div className="browser-pane-empty">{t('browser.network.noPayload')}</div>
          ))}
        {active === 'response' && (
          <>
            {detail?.truncated && <div className="browser-pane-empty">{t('browser.network.truncated')}</div>}
            {response ?? <div className="browser-pane-empty">{t(detail === undefined ? 'browser.network.loading' : 'browser.network.noBody')}</div>}
          </>
        )}
        {active === 'timing' && (
          <dl className="net-headers">
            <div className="net-header"><dt>{t('browser.network.col.time')}</dt><dd>{entry.timing === undefined ? '' : `${Math.round(entry.timing)} ms`}</dd></div>
            <div className="net-header"><dt>{t('browser.network.col.size')}</dt><dd>{entry.size} B</dd></div>
          </dl>
        )}
      </div>
    </div>
  );
}
