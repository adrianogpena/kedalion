import { useState } from 'react';
import { Button, IconButton } from '@kedalion/ui';
import { ConfigForm } from '../../ConfigForm';
import { tKey } from '../../i18n';
import { PODS_FIELDS } from './fields';
import { formatEntries, isEntryValid, parseEntries, type PodEntry } from './model';
import type { PodsConfig } from './PodsPanel';
import { PodEntryFields, usePodChoices } from './PodEntryFields';
import './pods.css';

const OTHER_FIELDS = PODS_FIELDS.filter((f) => f.key !== 'clusters');

function EntryRow({ config, entry, entries, onChange, action }: { config: PodsConfig; entry: PodEntry; entries: readonly PodEntry[]; onChange: (next: PodEntry) => void; action: React.ReactNode }) {
  const { contexts, namespaces } = usePodChoices(config, entry.context, entries.map((e) => e.namespace));
  return (
    <div className="pods-entry-row">
      <PodEntryFields entry={entry} onChange={onChange} contexts={contexts} namespaces={namespaces} compact />
      {action}
    </div>
  );
}

/** Set up and Configure form: tracked pods grouped by context as summary rows (one edited at a time), then the other settings. */
export function PodsConfigEditor({ value, onChange }: { value: PodsConfig; onChange: (next: PodsConfig) => void }) {
  const entries = parseEntries(value.clusters ?? '');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<PodEntry>({ context: '', namespace: '', pod: '' });
  const save = (next: PodEntry[]) => onChange({ ...value, clusters: formatEntries(next) });
  const groups = new Map<string, Map<string, number[]>>();
  entries.forEach((e, i) => {
    const byNs = groups.get(e.context) ?? new Map<string, number[]>();
    byNs.set(e.namespace, [...(byNs.get(e.namespace) ?? []), i]);
    groups.set(e.context, byNs);
  });
  const startAdd = () => {
    const last = entries[entries.length - 1];
    setDraft({ context: last?.context ?? '', namespace: last?.namespace ?? '', pod: '' });
    setEditing('new');
  };
  return (
    <div className="pods-editor">
      <div className="pods-editor-head">
        <span className="mono-label">{tKey('dash.pods.tracked')} ({entries.length})</span>
        <Button size="xs" icon="plus" disabled={editing === 'new'} onClick={startAdd}>
          {tKey('dash.pods.add')}
        </Button>
      </div>
      <div className="pods-editor-list">
        {entries.length === 0 && editing !== 'new' && <p className="pods-dim">{tKey('dash.pods.entry.empty')}</p>}
        {[...groups].map(([context, byNs]) => (
          <div key={context} className="pods-group">
            <div className="pods-group-head">{context || '—'}</div>
            {[...byNs].map(([namespace, indexes]) => {
              const shared = indexes.length > 1;
              return (
                <div key={namespace} className="pods-subgroup">
                  {shared && <div className="pods-group-head pods-group-ns">{namespace || '—'}</div>}
                  {indexes.map((i) =>
                    editing === i ? (
                      <EntryRow
                        key={i}
                        config={value}
                        entry={entries[i]}
                        entries={entries}
                        onChange={(e) => save(entries.map((x, j) => (j === i ? e : x)))}
                        action={<IconButton icon="check" label={tKey('dash.pods.entry.done')} onClick={() => setEditing(null)} />}
                      />
                    ) : (
                      <div key={i} className={shared ? 'pods-entry-summary pods-entry-nested' : 'pods-entry-summary'}>
                        <span className="pods-entry-text" title={`${entries[i].namespace} / ${entries[i].pod}`}>
                          {!shared && <><span className="pods-dim">{entries[i].namespace}</span> / </>}
                          {entries[i].pod}
                        </span>
                        <IconButton size="xs" icon="edit" label={tKey('dash.pods.entry.edit')} onClick={() => setEditing(i)} />
                        <IconButton
                          size="xs"
                          icon="close"
                          label={tKey('dash.pods.entry.remove')}
                          onClick={() => {
                            save(entries.filter((_, j) => j !== i));
                            setEditing(null);
                          }}
                        />
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {editing === 'new' && (
          <EntryRow
            config={value}
            entry={draft}
            entries={entries}
            onChange={setDraft}
            action={
              <>
                <Button
                  variant="primary"
                  disabled={!isEntryValid(draft)}
                  onClick={() => {
                    save([...entries, draft]);
                    setEditing(null);
                  }}
                >
                  {tKey('dash.pods.entry.add')}
                </Button>
                <IconButton icon="close" label={tKey('dash.pods.cancel')} onClick={() => setEditing(null)} />
              </>
            }
          />
        )}
      </div>
      <ConfigForm fields={OTHER_FIELDS} value={value} onChange={(v) => onChange({ ...value, ...v, clusters: value.clusters } as PodsConfig)} />
    </div>
  );
}
