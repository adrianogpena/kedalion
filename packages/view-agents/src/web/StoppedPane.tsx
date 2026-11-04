import { useEffect, useMemo, useState } from 'react';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import { CompactTranscript } from './chat/CompactTranscript';
import { Transcript } from './chat/Transcript';
import { sessionHistory } from './api';
import { summarize } from './session-summary';
import { StoppedCard, type StoppedCardProps } from './StoppedCard';
import type { StepFocus } from './trajectory/model';

const PAGE = 20;

/** A session that is not attached: the stopped-session card, then its read-only transcript (compact by default). */
export function StoppedPane({ focus, ...props }: StoppedCardProps & { focus?: StepFocus }) {
  const { id: sessionId, updatedAt } = props.session;
  const [events, setEvents] = useState<ChatEvent[] | undefined>();
  const [full, setFull] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    let live = true;
    setEvents(undefined);
    setLimit(PAGE);
    void sessionHistory(sessionId).then((r) => live && setEvents(r.events), () => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [sessionId, updatedAt]);
  useEffect(() => {
    if (focus) setFull(true);
  }, [focus?.at]);
  const list = useMemo(() => events ?? [], [events]);
  const summary = useMemo(() => summarize(list), [list]);
  return (
    <div className="agents-external">
      <StoppedCard {...props} summary={events ? summary : undefined} />
      <div className="agents-external-bar">
        <button type="button" className="chat-more" title={full ? t('agents.stopped.compact') : t('agents.stopped.showFull')} onClick={() => setFull((f) => !f)}>{full ? t('agents.stopped.compact') : t('agents.stopped.showFull')}</button>
      </div>
      {full ? <Transcript events={list} focus={focus} /> : <CompactTranscript events={list} limit={limit} onMore={() => setLimit((n) => n + PAGE)} resetKey={sessionId} />}
    </div>
  );
}
