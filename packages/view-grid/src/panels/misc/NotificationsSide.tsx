import { useAsync } from '@kedalion/ui';
import { fetchSource } from '../../source';
import type { NotificationLogEntry } from '../../server';
import { NotificationLog } from './NotificationLog';

const LAST = 20;

/** The app side panel's content: the last 20 notifications, refreshed while it is mounted. */
export function NotificationsSide() {
  const log = useAsync(() => fetchSource<NotificationLogEntry[]>('notification-log', { max: LAST }), [], 5_000);
  return <NotificationLog entries={(log.data ?? []).slice(0, LAST)} />;
}
