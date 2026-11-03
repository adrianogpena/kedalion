import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { t } from '@kedalion/ui';
import { useMemo } from 'react';
import { formatMs } from './http';
import { diffResponses } from './response-diff';
import './response-diff.css';

/** Diff of `live` against the pinned `baseline`: summary strip, then the body lines. */
export function ResponseDiffStrip({ baseline, live, dim }: { baseline: HttpResponseInfo; live: HttpResponseInfo; dim?: boolean }) {
  const diff = useMemo(() => diffResponses(baseline, live), [baseline, live]);
  const { status, time, headers, body } = diff;
  const delta = `${time.delta >= 0 ? '+' : '-'}${formatMs(Math.abs(time.delta))}`;
  const headerChanges = headers.added.length + headers.removed.length + headers.changed.length;
  const binary = !baseline.text && !live.text;
  return (
    <div className={`resp-diff${dim ? ' dim' : ''}`}>
      {diff.same && <div className="resp-diff-note">{t('http.noChanges')}</div>}
      <dl className="resp-diff-strip">
        <dt>{t('http.diff.status')}</dt>
        <dd>{status.changed ? `${status.from} → ${status.to}` : String(status.to)}</dd>
        <dt>{t('http.diff.time')}</dt>
        <dd>{formatMs(time.to)} ({delta})</dd>
        {headerChanges > 0 && (
          <>
            <dt>{t('http.diff.headers')}</dt>
            <dd>
              <span className="resp-diff-add">+{headers.added.length}</span> <span className="resp-diff-del">-{headers.removed.length}</span>
              {headers.added.map(([n, v]) => <div key={`a${n}`} className="resp-diff-add">+ {n}: {v}</div>)}
              {headers.removed.map(([n, v]) => <div key={`r${n}`} className="resp-diff-del">- {n}: {v}</div>)}
              {headers.changed.map(([n, from, to]) => (
                <div key={`c${n}`}>{n}: <span className="resp-diff-del">{from}</span> → <span className="resp-diff-add">{to}</span></div>
              ))}
            </dd>
          </>
        )}
      </dl>
      {binary && <div className="resp-diff-note">{t('http.diff.binary')}</div>}
      {(body?.partial || baseline.truncated || live.truncated) && <div className="resp-diff-note">{t('http.partialDiff')}</div>}
      {body && !diff.same && (
        <pre className="resp-diff-lines">
          {body.lines.map((line, i) => <div key={i} className={line.kind === 'add' ? 'resp-diff-add' : line.kind === 'del' ? 'resp-diff-del' : 'same'}>{line.text}</div>)}
        </pre>
      )}
    </div>
  );
}
