import { useEffect, useMemo, useState } from 'react';
import type { NetworkEntry } from '@kedalion/cdp';
import { copyNotify, IconButton, request, Tabs } from '@kedalion/ui';
import { toCurl } from './curl';
import { t } from './i18n';

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

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
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
  onClose(): void;
}

export function NetworkDetail({ tab, entry, onClose }: NetworkDetailProps) {
  const [active, setActive] = useState<DetailTab>('headers');
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
    return <pre className="net-body">{pretty(detail.body)}</pre>;
  }, [detail, entry.mime, entry.url]);

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
          (detail?.postData ? <pre className="net-body">{pretty(detail.postData)}</pre> : <div className="browser-pane-empty">{t('browser.network.noPayload')}</div>)}
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
