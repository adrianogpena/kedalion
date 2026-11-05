import { tKey } from '../../i18n';
import { Chip, relTime } from '../../kit';
import type { NotificationLogEntry } from '../../server';
import './misc.css';

const clock = (time: number): string => new Date(time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });

export function NotificationLog({ entries }: { entries: readonly NotificationLogEntry[] }) {
  if (entries.length === 0) return <p className="kit-empty">{tKey('dash.misc.notifLog.empty')}</p>;
  return (
    <ul className="misc-notif-list">
      {entries.map((e) => (
        <li key={e.id} className="misc-notif">
          <div className="misc-notif-head">
            <span className="misc-notif-title">{e.title}</span>
            {e.muted && <Chip tone="warn" title={tKey('dash.misc.notifLog.mutedHint')}>{tKey('dash.misc.notifLog.muted')}</Chip>}
            <Chip>{e.view}</Chip>
            <span className="misc-notif-time" title={clock(e.time)}>{relTime(e.time)}</span>
          </div>
          {e.body && <pre className="misc-notif-body">{e.body}</pre>}
        </li>
      ))}
    </ul>
  );
}
