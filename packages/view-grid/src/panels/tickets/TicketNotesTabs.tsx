import { Tabs } from '@kedalion/ui';
import { useState } from 'react';
import { tKey } from '../../i18n';
import { TicketFileEditor } from './TicketFile';
import { TicketNotes } from './TicketNotes';
import type { TemplateVars } from './note-templates';
import './tickets.css';

interface Props {
  ticketId: string;
  config: Record<string, unknown>;
  vars: TemplateVars;
}

type SubTab = 'task' | 'sql' | 'rest';

/** The side panel's Notes tab: the task notes, the ticket's SQL file and its REST file. */
export function TicketNotesTabs({ ticketId, config, vars }: Props) {
  const [tab, setTab] = useState<SubTab>('task');
  return (
    <div className="tickets-notes-tabs">
      <Tabs
        idPrefix="tickets-notes"
        active={tab}
        onChange={(id) => setTab(id as SubTab)}
        tabs={[
          { id: 'task', label: tKey('dash.tickets.notes.task') },
          { id: 'sql', label: tKey('dash.tickets.notes.sql') },
          { id: 'rest', label: tKey('dash.tickets.notes.rest') },
        ]}
      />
      <div className="tickets-notes-tabs-body">
        {tab === 'task' && <TicketNotes ticketId={ticketId} config={config} vars={vars} />}
        {tab === 'sql' && <TicketFileEditor ticketId={ticketId} kind="sql" config={config} />}
        {tab === 'rest' && <TicketFileEditor ticketId={ticketId} kind="rest" config={config} />}
      </div>
    </div>
  );
}
