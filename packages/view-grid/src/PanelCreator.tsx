import { useMemo, useState } from 'react';
import { Button, Icon, IconButton, Modal, validConfig, type GridItem, type PanelConfig } from '@kedalion/ui';
import { ConfigForm } from './ConfigForm';
import type { DashboardPreset } from './dashboard/model';
import { tKey } from './i18n';
import { fieldsOf, initialConfig, type AnyPanelKind } from './panel';

/** The kinds the creator offers: those that allow several instances, or have none on the grid yet. */
export const addableKinds = (kinds: readonly AnyPanelKind[], items: readonly GridItem[]): AnyPanelKind[] =>
  kinds.filter((k) => k.allowMultiple !== false || !items.some((i) => i.kind === k.kind));

/** Groups kinds by category, keeping the order of first appearance; the core category goes first, kinds without one last. */
export function groupByCategory(kinds: readonly AnyPanelKind[]): Array<{ category: string; kinds: AnyPanelKind[] }> {
  const other = 'grid.category.other';
  const core = 'dash.category.core';
  const groups = new Map<string, AnyPanelKind[]>();
  for (const k of kinds) groups.set(k.category ?? other, [...(groups.get(k.category ?? other) ?? []), k]);
  const entries = [...groups.entries()].map(([category, list]) => ({ category, kinds: list }));
  return [
    ...entries.filter((g) => g.category === core),
    ...entries.filter((g) => g.category !== other && g.category !== core),
    ...entries.filter((g) => g.category === other),
  ];
}

/** "Add panel": pick a kind, set it up when it has fields, then `onAdd`. */
export function PanelCreator({ kinds, items, onAdd, onClose, presets, onAddPreset, onRenamePreset, onDeletePreset }: {
  kinds: readonly AnyPanelKind[];
  items: readonly GridItem[];
  onAdd: (kind: AnyPanelKind, config: PanelConfig | undefined) => void;
  onClose: () => void;
  /** Saved presets; the "My panels" section shows when this is given. */
  presets?: readonly DashboardPreset[];
  onAddPreset?: (preset: DashboardPreset) => void;
  onRenamePreset?: (preset: DashboardPreset) => void;
  onDeletePreset?: (preset: DashboardPreset) => void;
}) {
  const mine = useMemo(() => (presets ?? []).filter((p) => kinds.some((k) => k.kind === p.kind)), [presets, kinds]);
  const available = useMemo(() => addableKinds(kinds, items), [kinds, items]);
  const groups = useMemo(() => groupByCategory(available), [available]);
  const [picked, setPicked] = useState<AnyPanelKind>();
  const [draft, setDraft] = useState<PanelConfig>({});

  const finish = (kind: AnyPanelKind, config: PanelConfig) => {
    const fields = fieldsOf(kind);
    onAdd(kind, fields.length > 0 ? validConfig(fields, config) : undefined);
    onClose();
  };
  const pick = (kind: AnyPanelKind) => {
    if (fieldsOf(kind).length === 0) return finish(kind, {});
    setDraft(initialConfig(kind));
    setPicked(kind);
  };

  if (picked) {
    const name = tKey(picked.title);
    return (
      <Modal
        title={tKey('grid.creator.configure', { name })}
        onClose={onClose}
        footer={
          <>
            <Button title={tKey('grid.back')} onClick={() => setPicked(undefined)}>{tKey('grid.back')}</Button>
            <Button variant="primary" icon="plus" title={tKey('grid.create')} onClick={() => finish(picked, draft)}>{tKey('grid.create')}</Button>
          </>
        }
      >
        {picked.configEditor ? <picked.configEditor value={draft} onChange={setDraft} /> : <ConfigForm fields={fieldsOf(picked)} value={draft} onChange={setDraft} />}
      </Modal>
    );
  }

  return (
    <Modal title={tKey('grid.creator.title')} onClose={onClose} large>
      <div className="grid-creator-scroll">
      {mine.length > 0 && (
        <section className="grid-creator-group">
          <h3 className="mono-label">{tKey('dash.preset.mine')}</h3>
          <div className="grid-creator-list">
            {mine.map((p) => {
              const kind = kinds.find((k) => k.kind === p.kind)!;
              const blocked = kind.allowMultiple === false && items.some((i) => i.kind === p.kind);
              return (
                <div key={p.id} className="grid-creator-preset">
                  <Button
                    className="grid-creator-kind"
                    title={blocked ? tKey('dash.preset.once') : p.name}
                    disabled={blocked}
                    onClick={() => {
                      onAddPreset?.(p);
                      onClose();
                    }}
                  >
                    <Icon name={p.icon ?? kind.icon} size={18} />
                    <span className="grid-creator-text">
                      <span className="grid-creator-title">{p.name}</span>
                      <span className="grid-creator-desc">{p.title ?? tKey(kind.title)}</span>
                    </span>
                  </Button>
                  <IconButton icon="edit" label={tKey('dash.preset.rename')} onClick={() => onRenamePreset?.(p)} />
                  <IconButton icon="trash" label={tKey('dash.preset.delete')} onClick={() => onDeletePreset?.(p)} />
                </div>
              );
            })}
          </div>
        </section>
      )}
      {groups.length === 0 && mine.length === 0 && <p className="muted">{tKey('grid.creator.empty')}</p>}
      {groups.map((g) => (
        <section key={g.category} className="grid-creator-group">
          <h3 className="mono-label">{tKey(g.category)}</h3>
          <div className="grid-creator-list">
            {g.kinds.map((k) => (
              <Button key={k.kind} className="grid-creator-kind" title={tKey(k.description)} onClick={() => pick(k)}>
                <Icon name={k.icon} size={18} />
                <span className="grid-creator-text">
                  <span className="grid-creator-title">{tKey(k.title)}</span>
                  <span className="grid-creator-desc">{tKey(k.description)}</span>
                </span>
              </Button>
            ))}
          </div>
        </section>
      ))}
      </div>
    </Modal>
  );
}
