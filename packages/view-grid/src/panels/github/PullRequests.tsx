import { tKey } from '../../i18n';
import { Chip, hasColumn, ListRows, relTime, type ListRow } from '../../kit';
import type { PanelSide } from '../../panel';
import './github.css';
import { ciLabelKey, type PrItem, type SearchData } from './map';
import { CI_TONE, prSideContent, REVIEW_TONE, useFreshPrs } from './PrSide';

export interface PullRequestsConfig {
  columns: string[];
  density?: string;
  [key: string]: unknown;
}

export interface PrRowActions {
  isSelected(pr: PrItem): boolean;
  toggle(pr: PrItem): void;
}

export function prRows(config: PullRequestsConfig, items: readonly PrItem[], actions?: PrRowActions): ListRow[] {
  const has = (c: string) => hasColumn(config, 'columns', c);
  return items.map((pr) => {
    const noTicket = has('ticket') && !pr.linked;
    const status = (
      <span className="gh-chips gh-status">
        {noTicket && (
          <Chip tone="warn" title={pr.ticket ? tKey('dash.github.noTicket.notOnBoard', { key: pr.ticket }) : tKey('dash.github.noTicket.noKey')}>
            {tKey('dash.github.noTicket')}
          </Chip>
        )}
        {pr.draft && <Chip>{tKey('dash.github.draft')}</Chip>}
        {pr.conflicts && <Chip tone="danger">{tKey('dash.github.conflicts')}</Chip>}
        {has('review') && pr.review !== 'none' && <Chip tone={REVIEW_TONE[pr.review]}>{tKey(`dash.github.review.${pr.review}`)}</Chip>}
        {pr.threads > 0 && (
          <Chip tone="warn" title={tKey('dash.github.threads', { n: pr.threads })}>
            {tKey('dash.github.unresolved')}
          </Chip>
        )}
        {has('checks') && pr.ci !== 'none' && (
          <Chip tone={CI_TONE[ciLabelKey(pr)]} title={pr.failing.length ? tKey('dash.github.ci.failing', { names: pr.failing.join(', ') }) : undefined}>
            {tKey(`dash.github.ci.${ciLabelKey(pr)}`)}
            {pr.checks.total > 0 && ` ${pr.checks.passed}/${pr.checks.total}`}
          </Chip>
        )}
      </span>
    );
    const meta = [
      has('repo') ? `${pr.repo}#${pr.number}` : `#${pr.number}`,
      has('author') ? pr.author : '',
      has('branch') ? pr.branch : '',
      has('size') ? `+${pr.additions} −${pr.deletions}` : '',
      has('labels') ? pr.labels.join(', ') : '',
    ].filter(Boolean);
    const age = has('created') ? relTime(pr.createdAt) : has('updated') ? relTime(pr.updatedAt) : undefined;
    const base = {
      id: pr.id,
      href: actions ? undefined : pr.url,
      status,
      ...(actions ? { selected: actions.isSelected(pr), onClick: () => actions.toggle(pr) } : {}),
    };
    if (config.density === 'compact') return { ...base, title: `#${pr.number} ${pr.title}` };
    return { ...base, title: pr.title, meta, trailing: age };
  });
}

interface Props {
  id: string;
  config: PullRequestsConfig;
  data: SearchData<PrItem> | undefined;
  side?: PanelSide;
}

export function PullRequestsPanel({ id, config, data, side }: Props) {
  const items = useFreshPrs(data?.items ?? []);
  const content = (pr: PrItem) => prSideContent({ instanceId: id, pr, config });
  const actions: PrRowActions | undefined = side
    ? {
        isSelected: (pr) => side.isOpen(content(pr).id),
        toggle: (pr) => {
          const c = content(pr);
          if (side.isOpen(c.id)) side.close();
          else side.open(c);
        },
      }
    : undefined;
  return (
    <div className={config.density === 'compact' ? 'gh gh-compact' : 'gh'}>
      <div className="gh-head muted">{tKey('dash.github.count', { n: data?.total ?? 0 })}</div>
      <ListRows rows={prRows(config, items, actions)} empty={tKey('dash.github.empty')} />
    </div>
  );
}
