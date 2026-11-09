import { useState, type FormEvent } from 'react';
import { Button, errorMessage, errorOf, IconButton } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip, type Tone } from '../../kit';
import { runAction } from '../../source';
import './github.css';
import type { CheckState, TrackedPr } from './tracked';

export interface TrackedConfig {
  readyLabel: string | string[];
  rcLabel: string | string[];
  [key: string]: unknown;
}

const STATE_TONE: Record<string, Tone> = { open: 'ok', merged: 'info', closed: 'danger' };
const CHECK_TONE: Record<string, Tone> = { passed: 'ok', failed: 'danger', pending: 'warn' };
const DETAIL_TONE: Record<CheckState, Tone> = { success: 'ok', failure: 'danger', pending: 'warn', neutral: 'neutral' };
const REVIEW_TONE: Record<string, Tone> = { APPROVED: 'ok', CHANGES_REQUESTED: 'danger', REVIEW_REQUIRED: 'warn' };

function ChecksChip({ pr }: { pr: TrackedPr }) {
  if (pr.checks.state === 'none') return null;
  return (
    <span className="gh-checks">
      <Chip tone={CHECK_TONE[pr.checks.state]}>{tKey('dash.github.tracked.checks', { n: pr.checks.passed, m: pr.checks.total })}</Chip>
      <span className="gh-card" role="tooltip">
        {pr.checks.details.map((d) => (
          <span key={`${d.name}-${d.state}`} className="gh-card-row">
            <Chip tone={DETAIL_TONE[d.state]}>{tKey(`dash.github.tracked.check.${d.state}`)}</Chip>
            {d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer">
                {d.name}
              </a>
            ) : (
              <span>{d.name}</span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}

export function TrackedPrsPanel({ config, data, refresh }: { config: TrackedConfig; data: { items: TrackedPr[] } | undefined; refresh(): void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = data?.items ?? [];

  const act = async (name: string, payload: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      await runAction('github-tracked', name, config, payload);
      refresh();
      return true;
    } catch (err) {
      setError(errorMessage(errorOf(err)));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (text.trim() && (await act('track', { ref: text }))) setText('');
  };

  return (
    <div className="gh">
      <form className="gh-track" onSubmit={submit}>
        <input value={text} placeholder={tKey('dash.github.tracked.placeholder')} aria-label={tKey('dash.github.tracked.placeholder')} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={busy || !text.trim()}>
          {tKey('dash.github.tracked.track')}
        </Button>
      </form>
      {error && <div className="gh-error" role="alert">{error}</div>}
      <div className="gh-list">
        {items.length === 0 && <div className="muted gh-head">{tKey('dash.github.tracked.empty')}</div>}
        {items.map((pr) => (
          <div key={`${pr.owner}/${pr.repo}#${pr.number}`} className="kit-row gh-tracked-row">
            <div className="kit-row-main">
              <a className="kit-row-title" href={pr.url} target="_blank" rel="noreferrer">
                {pr.title}
              </a>
              <span className="muted gh-head">
                {pr.owner}/{pr.repo}#{pr.number}
              </span>
              <span className="gh-chips">
                <Chip tone={STATE_TONE[pr.state]}>{tKey(`dash.github.tracked.state.${pr.state}`)}</Chip>
                {pr.draft && <Chip>{tKey('dash.github.draft')}</Chip>}
                <ChecksChip pr={pr} />
                {pr.reviewDecision && <Chip tone={REVIEW_TONE[pr.reviewDecision]}>{tKey(`dash.github.tracked.review.${pr.reviewDecision}`)}</Chip>}
                {pr.ready && <Chip tone="ok">{tKey('dash.github.tracked.ready')}</Chip>}
                {pr.rc && <Chip tone="info">{tKey('dash.github.tracked.rc')}</Chip>}
                {pr.labels.map((l) => (
                  <Chip key={l}>{l}</Chip>
                ))}
              </span>
            </div>
            <IconButton icon="trash" label={tKey('dash.github.tracked.untrack')} disabled={busy} onClick={() => void act('untrack', { owner: pr.owner, repo: pr.repo, number: pr.number })} />
          </div>
        ))}
      </div>
    </div>
  );
}
