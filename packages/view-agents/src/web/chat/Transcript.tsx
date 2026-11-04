import { useLayoutEffect, useMemo, useRef } from 'react';
import { MarkdownView } from '@kedalion/editor';
import type { ChatEvent } from '../../chat-protocol.ts';
import { t } from '../../i18n';
import type { StepFocus } from '../trajectory/model';
import { focusIndex, toolSummary, transcriptItems, type ToolResult, type TranscriptItem } from './chat-model';

function ResultBody({ result }: { result: ToolResult }) {
  return (
    <div className={`chat-tool-result${result.isError ? ' error' : ''}`}>
      <pre>{result.content}</pre>
      {result.truncated && <span className="chat-truncated">{t('agents.chat.truncated')}</span>}
    </div>
  );
}

function ToolCall({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const { use, result } = item;
  const status = !result ? 'pending' : result.isError ? 'error' : 'ok';
  return (
    <details className={`chat-tool ${status}${use.parentId ? ' sub' : ''}`}>
      <summary>
        <span className={`agents-dot ${status === 'pending' ? 'running' : status === 'error' ? 'error' : 'idle'}`} aria-hidden="true" />
        <span className="chat-tool-name">{use.name}</span>
        <span className="chat-tool-summary">{toolSummary(use.input)}</span>
        {!result && <span className="chat-tool-state">{t('agents.chat.tool.running')}</span>}
        {result?.isError && <span className="chat-tool-state">{t('agents.chat.tool.failed')}</span>}
      </summary>
      <pre className="chat-tool-input">{JSON.stringify(use.input, null, 2)}</pre>
      {result && <ResultBody result={result} />}
    </details>
  );
}

function EventRow({ event }: { event: Extract<TranscriptItem, { kind: 'event' }>['event'] }) {
  switch (event.type) {
    case 'user':
      return <div className="chat-user">{event.text}</div>;
    case 'text':
      return <div className={`chat-assistant${event.parentId ? ' sub' : ''}`}><MarkdownView markdown={event.text} /></div>;
    case 'delta':
      return <div className="chat-assistant streaming"><MarkdownView markdown={event.text} /></div>;
    case 'init':
      return <div className="chat-note">{event.model ? t('agents.chat.started.model', { model: event.model }) : t('agents.chat.started')}</div>;
    case 'interrupted':
      return <div className="chat-note">{t('agents.chat.interrupted')}</div>;
    case 'notice':
      return <div className="chat-note">{event.text}</div>;
    case 'result':
      if (event.aborted) return null;
      return (
        <div className={`chat-note${event.isError ? ' error' : ''}`}>
          {event.isError ? t('agents.chat.turnFailed') : t('agents.chat.turnDone')}
          {event.durationMs != null && ` · ${(event.durationMs / 1000).toFixed(1)}s`}
        </div>
      );
    case 'error':
      return <div className="chat-note error">{event.message}</div>;
  }
}

/** The chat transcript: history then live events. Tool calls collapse; thinking is not shown. */
export function Transcript({ events, focus }: { events: ChatEvent[]; focus?: StepFocus }) {
  const items = useMemo(() => transcriptItems(events), [events]);
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const done = useRef<number>();
  const at = useMemo(() => focusIndex(items, focus), [items, focus]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus && at >= 0 && done.current !== focus.at) {
      done.current = focus.at;
      pinned.current = false;
      el.querySelector<HTMLElement>(`[data-item="${at}"]`)?.scrollIntoView({ block: 'center' });
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, focus, at]);

  return (
    <div
      className="chat-transcript"
      ref={ref}
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {items.length === 0 && <p className="agents-empty chat-empty">{t('agents.chat.empty')}</p>}
      {items.map((item, i) => (
        <div key={item.kind === 'tool' ? item.use.id : item.kind === 'orphan' ? `r${i}` : i} data-item={i} className={i === at && focus ? 'chat-item chat-focus' : 'chat-item'}>
          {item.kind === 'tool' ? <ToolCall item={item} />
          : item.kind === 'orphan' ? (
            <details className={`chat-tool ${item.result.isError ? 'error' : 'ok'}`}>
              <summary><span className="chat-tool-name">{t('agents.chat.tool.result')}</span></summary>
              <ResultBody result={item.result} />
            </details>
          )
          : <EventRow event={item.event} />}
        </div>
      ))}
    </div>
  );
}
