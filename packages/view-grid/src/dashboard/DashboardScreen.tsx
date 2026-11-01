import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { addItem, Button, ContextMenu, Empty, PageHead, PanelGrid, sameItems, t, useCommand, useDialogs, useViewSidePanel, validConfig, ViewSidePanel,type ContextMenuItem, type GridItem, type PanelConfig } from '@kedalion/ui';
import { ConfigDialog } from '../ConfigForm';
import { ConnectionsDialog } from '../connections/ConnectionsDialog';
import { tKey } from '../i18n';
import { dashboardCommands } from './commands';
import { setDashboardItems } from './items';
import { fieldsOf, kindSpecs, panelDef, type AnyPanelKind } from '../panel';
import { addableKinds, PanelCreator } from '../PanelCreator';
import { PanelHost } from '../PanelHost';
import { activeLayout, itemFromPreset, layoutsOrDefault, MAX_LAYOUTS, MAX_NAME, MAX_PRESETS, newLayoutId, newPresetId, presetFromItem, validDashboardPresets, type DashboardLayouts, type DashboardPreset } from './model';
import '../grid.css';
import './dashboard.css';

/** The slice of the app settings the screen reads and writes. */
export interface DashboardViewSettings {
  /** Saved layouts (`DashboardLayouts`); the server validates them. */
  dashboardLayouts?: unknown;
  /** Saved panel presets (`DashboardPreset[]`); the server validates them. */
  dashboardPresets?: unknown;
}

/** Unsaved items of a layout, kept while another screen is shown; a restart drops them. */
let unsaved: { layoutId: string; items: GridItem[] } | null = null;

export interface DashboardScreenProps {
  settings: DashboardViewSettings;
  onSave: (patch: DashboardViewSettings) => void;
  panels: readonly AnyPanelKind[];
}

const nameError = (value: string): string | null => (value.trim().length >= 1 && value.trim().length <= MAX_NAME ? null : tKey('dash.nameInvalid'));

export function DashboardScreen({ settings, onSave, panels }: DashboardScreenProps) {
  const specs = useMemo(() => kindSpecs(panels), [panels]);
  const defs = useMemo(() => panels.map((k) => panelDef(k, tKey(k.title))), [panels]);
  const [state, setState] = useState<DashboardLayouts>(() => layoutsOrDefault(settings.dashboardLayouts, specs, tKey('dash.defaultName')));
  const [items, setItems] = useState<GridItem[]>(() => {
    const current = activeLayout(state);
    return unsaved && unsaved.layoutId === current.id ? unsaved.items : current.items;
  });
  const [presets, setPresets] = useState<DashboardPreset[]>(() => validDashboardPresets(settings.dashboardPresets, specs) ?? []);
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; id: string } | null>(null);
  const { confirm, prompt, choose, element } = useDialogs();
  const side = useViewSidePanel('dashboard');

  const current = activeLayout(state);
  setDashboardItems(state.layouts.flatMap((l) => (l.id === current.id ? items : l.items)));
  const dirty = !sameItems(items, current.items);

  const change = (next: GridItem[]) => {
    unsaved = sameItems(next, current.items) ? null : { layoutId: current.id, items: next };
    setItems(next);
  };
  const persist = (next: DashboardLayouts) => {
    setState(next);
    onSave({ dashboardLayouts: next });
  };
  const withItems = (layouts: DashboardLayouts, id: string, next: GridItem[]): DashboardLayouts => ({
    ...layouts,
    layouts: layouts.layouts.map((l) => (l.id === id ? { ...l, items: next } : l)),
  });
  const save = (): DashboardLayouts => {
    const next = withItems(state, current.id, items);
    persist(next);
    unsaved = null;
    return next;
  };
  /** Resolves to the layouts to continue from when it is fine to leave the layout (nothing unsaved, or the user saved or discarded), else null. */
  const settle = async (): Promise<DashboardLayouts | null> => {
    if (!dirty) return state;
    const answer = await choose({
      title: tKey('dash.unsaved.title'),
      body: tKey('dash.unsaved.body', { name: current.name }),
      choices: [
        { id: 'save', label: tKey('dash.unsaved.save') },
        { id: 'discard', label: tKey('dash.unsaved.discard'), danger: true },
      ],
    });
    if (answer === null) return null;
    if (answer === 'save') return save();
    unsaved = null;
    return state;
  };
  const show = (layouts: DashboardLayouts, id: string) => {
    const target = layouts.layouts.find((l) => l.id === id)!;
    persist({ ...layouts, active: id });
    setItems(target.items);
    setConfiguring(null);
  };
  const base = (): DashboardLayouts => (dirty ? withItems(state, current.id, current.items) : state);

  const switchTo = async (id: string) => {
    if (id === current.id) return;
    const layouts = await settle();
    if (layouts) show(layouts, id);
  };
  const askName = (value: string) => prompt({ title: tKey('dash.rename'), label: tKey('dash.nameLabel'), value, validate: nameError });
  const addLayout = async (layouts: DashboardLayouts, name: string, from: GridItem[]) => {
    const chosen = await askName(name);
    if (chosen === null) return;
    const id = newLayoutId(layouts.layouts);
    show({ ...layouts, layouts: [...layouts.layouts, { id, name: chosen.trim(), items: from }] }, id);
  };
  const newEmpty = async () => {
    const layouts = await settle();
    if (layouts) await addLayout(layouts, tKey('dash.newName'), []);
  };
  const duplicate = async (id: string) => {
    const layouts = await settle();
    if (!layouts) return;
    const source = layouts.layouts.find((l) => l.id === id)!;
    await addLayout(layouts, tKey('dash.copyName', { name: source.name }), source.items);
  };
  const rename = async (id: string) => {
    const source = state.layouts.find((l) => l.id === id)!;
    const chosen = await askName(source.name);
    if (chosen === null) return;
    persist({ ...base(), layouts: base().layouts.map((l) => (l.id === id ? { ...l, name: chosen.trim() } : l)) });
  };
  const remove = async (id: string) => {
    if (state.layouts.length <= 1) return;
    const source = state.layouts.find((l) => l.id === id)!;
    const ok = await confirm({ title: tKey('dash.deleteTitle'), body: tKey('dash.deleteBody', { name: source.name }), okLabel: tKey('dash.delete.ok'), danger: true });
    if (!ok) return;
    const rest = state.layouts.filter((l) => l.id !== id);
    if (id !== current.id) {
      persist({ ...base(), layouts: rest });
      return;
    }
    unsaved = null;
    show({ ...state, layouts: rest }, rest[0]!.id);
  };

  const full = state.layouts.length >= MAX_LAYOUTS;
  const menuOf = (id: string): ContextMenuItem[] => [
    { id: 'duplicate', label: tKey('dash.duplicate'), icon: 'copy', disabled: full, hint: full ? tKey('dash.tooMany') : undefined, run: () => void duplicate(id) },
    { id: 'rename', label: tKey('dash.rename'), icon: 'edit', run: () => void rename(id) },
    { id: 'delete', label: tKey('dash.delete'), icon: 'trash', danger: true, disabled: state.layouts.length <= 1, hint: state.layouts.length <= 1 ? tKey('dash.deleteLast') : undefined, run: () => void remove(id) },
  ];

  const storePresets = (next: DashboardPreset[]) => {
    setPresets(next);
    onSave({ dashboardPresets: next });
  };
  const savePreset = async (item: GridItem) => {
    const name = await prompt({ title: tKey('dash.preset.save'), label: tKey('dash.preset.name'), value: item.title ?? '', validate: nameError });
    if (name === null) return;
    storePresets([...presets, presetFromItem(item, newPresetId(presets), name)]);
  };
  const renamePreset = async (preset: DashboardPreset) => {
    const name = await prompt({ title: tKey('dash.preset.rename'), label: tKey('dash.preset.name'), value: preset.name, validate: nameError });
    if (name === null) return;
    storePresets(presets.map((p) => (p.id === preset.id ? { ...p, name: name.trim() } : p)));
  };
  const deletePreset = async (preset: DashboardPreset) => {
    const ok = await confirm({ title: tKey('dash.preset.deleteTitle'), body: tKey('dash.preset.deleteBody', { name: preset.name }), okLabel: tKey('dash.delete.ok'), danger: true });
    if (ok) storePresets(presets.filter((p) => p.id !== preset.id));
  };

  const kindOf = (kind: string) => panels.find((k) => k.kind === kind);
  const itemMenu = (item: GridItem): ContextMenuItem[] => {
    const kind = kindOf(item.kind);
    if (!kind) return [];
    const full = presets.length >= MAX_PRESETS;
    const out: ContextMenuItem[] = [];
    if (fieldsOf(kind).length > 0) out.push({ id: 'configure', label: t('panel.configure'), icon: 'settings', run: () => setConfiguring(item.id) });
    out.push({ id: 'preset', label: tKey('dash.preset.save'), icon: 'plus', disabled: full, hint: full ? tKey('dash.preset.tooMany') : undefined, run: () => void savePreset(item) });
    return out;
  };
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setItemConfig = (id: string, config: PanelConfig) => change(itemsRef.current.map((i) => (i.id === id ? { ...i, config } : i)));
  const sideContentId = side.content?.id;
  useEffect(() => {
    if (sideContentId && !items.some((i) => sideContentId.startsWith(`${i.id}:`))) side.closeAll();
  }, [items, sideContentId]);
  useCommand(dashboardCommands()[0]!, side.toggle);
  const target = configuring ? items.find((i) => i.id === configuring) : undefined;
  const targetKind = target && kindOf(target.kind);
  const canAdd = addableKinds(panels, items).length > 0;

  return (
    <div className="content">
      <PageHead title={tKey('nav.dashboard')}>
        <div className="dash-layout-tabs" role="tablist" aria-label={tKey('dash.layout')}>
          {state.layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === current.id}
              className={`dash-layout-tab${l.id === current.id ? ' active' : ''}`}
              onClick={() => void switchTo(l.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuAt({ x: e.clientX, y: e.clientY, id: l.id });
              }}
            >
              {l.name}
            </button>
          ))}
          <Button size="sm" icon="plus" title={full ? tKey('dash.tooMany') : tKey('dash.new')} aria-label={tKey('dash.new')} onClick={() => void newEmpty()} disabled={full} />
        </div>
        <Button size="sm" icon="plus" title={tKey('grid.add')} onClick={() => setCreating(true)} disabled={!canAdd}>{tKey('grid.add')}</Button>
        <Button size="sm" icon="link" title={tKey('dash.connections')} onClick={() => setConnecting(true)}>{tKey('dash.connections')}</Button>
        <Button size="sm" variant={dirty ? 'primary' : 'default'} icon="check" title={tKey('grid.save')} onClick={save} disabled={!dirty}>
          {dirty && <span className="dirty-dot" aria-hidden="true" />} {tKey('grid.save')}
        </Button>
        <Button size="sm" icon="rotate-ccw" title={tKey('grid.reset')} onClick={() => change(current.items)} disabled={!dirty}>{tKey('grid.reset')}</Button>
      </PageHead>
      <ViewSidePanel side={side}>
      <div className="scroll dash-scroll">
        {items.length === 0 ? (
          <Empty title={tKey('dash.empty.title')}>
            <p>{tKey('dash.empty.body')}</p>
            <Button icon="plus" variant="primary" onClick={() => setCreating(true)} disabled={!canAdd}>{tKey('grid.add')}</Button>
          </Empty>
        ) : (
          <PanelGrid
            items={items}
            defs={defs}
            render={(item) => {
              const kind = kindOf(item.kind);
              if (!kind) return null;
              return (
                <PanelHost
                  kind={kind}
                  item={item}
                  onConfigure={fieldsOf(kind).length > 0 ? () => setConfiguring(item.id) : undefined}
                  side={side}
                  setConfig={(config) => setItemConfig(item.id, config)}
                />
              );
            }}
            actions={(item) => {
              const kind = kindOf(item.kind);
              return (
                kind?.headerActions &&
                createElement(kind.headerActions, { config: validConfig(fieldsOf(kind), item.config), side, setConfig: (config: PanelConfig) => setItemConfig(item.id, config) })
              );
            }}
            itemMenu={itemMenu}
            onChange={change}
          />
        )}
      </div>
      </ViewSidePanel>
      {connecting && <ConnectionsDialog onClose={() => setConnecting(false)} />}
      {menuAt && <ContextMenu at={menuAt} items={menuOf(menuAt.id)} onClose={() => setMenuAt(null)} />}
      {creating && (
        <PanelCreator
          kinds={panels}
          items={items}
          onAdd={(kind, config: PanelConfig | undefined) => change(addItem(items, defs.find((d) => d.id === kind.kind)!, config))}
          onClose={() => setCreating(false)}
          presets={presets}
          onAddPreset={(p) => change(itemFromPreset(items, p, defs.find((d) => d.id === p.kind)!))}
          onRenamePreset={(p) => void renamePreset(p)}
          onDeletePreset={(p) => void deletePreset(p)}
        />
      )}
      {target && targetKind && (
        <ConfigDialog
          name={target.title ?? tKey(targetKind.title)}
          fields={fieldsOf(targetKind)}
          editor={targetKind.configEditor}
          value={target.config ?? {}}
          onSave={(config) => change(items.map((i) => (i.id === target.id ? { ...i, config } : i)))}
          onClose={() => setConfiguring(null)}
        />
      )}
      {element}
    </div>
  );
}
