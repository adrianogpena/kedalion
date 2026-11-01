import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor, type Compactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  BREAKPOINTS,
  COLS,
  ROW_HEIGHT,
  breakpointOf,
  fromGridLayout,
  pushSideways,
  sameGeometry,
  toGridLayout,
  MAX_TITLE,
  type GridItem,
  type PanelDef,
} from '../grid';
import { t } from '../i18n';
import type { ContextMenuItem } from './ContextMenu';
import { IconPicker } from './IconPicker';
import { Icon, useDialogs } from './ui';
import { PANEL_HANDLE, PANEL_NO_DRAG, PanelFrame } from './Panel';

const MARGIN = [12, 12] as const;

export interface PanelGridProps {
  items: GridItem[];
  defs: PanelDef[];
  /** Content of one panel; the grid adds the frame (title, icon, collapse, remove). */
  render: (item: GridItem) => ReactNode;
  /** Extra header buttons of one panel, left of the built-in ones. */
  actions?: (item: GridItem) => ReactNode;
  /** Extra menu entries of one panel, before the built-in ones. */
  itemMenu?: (item: GridItem) => ContextMenuItem[];
  /** Called with the new items after a drag, resize, collapse or remove. */
  onChange: (items: GridItem[]) => void;
}

/**
 * Draggable, resizable panels. Only the full-width (lg) layout is editable and saved; the
 * narrower breakpoints show a layout the grid derives from it.
 */
export function PanelGrid({ items, defs, render, actions, itemMenu, onChange }: PanelGridProps) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });
  const editable = breakpointOf(width) === 'lg';
  const known = useMemo(() => items.filter((i) => defs.some((d) => d.id === i.kind)), [items, defs]);
  const layout = useMemo(() => toGridLayout(known, defs), [known, defs]);
  const dialogs = useDialogs();
  const [picking, setPicking] = useState<string | null>(null);
  const latest = useRef(items);
  latest.current = items;
  const resizing = useRef<string | null>(null);
  const compactor = useMemo<Compactor>(() => ({
    ...verticalCompactor,
    compact: (next, cols) => {
      const id = resizing.current;
      if (!id) return verticalCompactor.compact(next, cols);
      const pushed = pushSideways(latest.current, fromGridLayout(next, latest.current), id);
      return verticalCompactor.compact(next.map((l) => {
        const p = pushed.find((i) => i.id === l.i);
        return p ? { ...l, x: p.x, y: p.y } : l;
      }), cols);
    },
  }), []);

  const commitLayout = (next: Layout, resizedId?: string) => {
    if (!editable) return;
    const current = latest.current;
    let merged = fromGridLayout(next, current);
    if (resizedId) merged = pushSideways(current, merged, resizedId);
    if (!sameGeometry(merged, current)) onChange(merged);
  };

  const patch = (id: string, change: Partial<GridItem>) =>
    onChange(latest.current.map((i) => (i.id === id ? { ...i, ...change } : i)));

  const rename = async (item: GridItem, def: PanelDef) => {    const value = await dialogs.prompt({
      title: t('panel.rename'),
      label: t('panel.name'),
      value: item.title ?? def.title,
      validate: (v) => (v.trim().length > MAX_TITLE ? t('panel.nameTooLong', { max: MAX_TITLE }) : null),
    });
    if (value === null) return;
    patch(item.id, { title: value.trim() || undefined });
  };

  const pickingItem = picking ? items.find((i) => i.id === picking) : undefined;
  const pickingDef = pickingItem && defs.find((d) => d.id === pickingItem.kind);

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} className="panel-grid">
      <ResponsiveGridLayout
        width={width}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        layouts={{ lg: layout, md: layout, sm: layout }}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        compactor={compactor}
        dragConfig={{ enabled: editable, handle: `.${PANEL_HANDLE}`, cancel: `.${PANEL_NO_DRAG}` }}
        resizeConfig={{ enabled: editable, handles: ['se', 'sw'] }}
        onDragStop={(next) => commitLayout(next)}
        onResizeStart={(_l, _o, resized) => { resizing.current = resized?.i ?? null; }}
        onResizeStop={(next, _old, resized) => {
          resizing.current = null;
          commitLayout(next, resized?.i);
        }}
      >
        {known.map((item) => {
          const def = defs.find((d) => d.id === item.kind)!;
          return (
            <div key={item.id} data-link-scope={`panel:${item.kind}`}>
              <PanelFrame
                title={item.title ?? def.title}
                icon={<Icon name={item.icon ?? def.icon} />}
                actions={actions?.(item)}
                menu={[
                  ...(itemMenu?.(item) ?? []),
                  { id: 'rename', label: t('panel.rename'), icon: 'edit', run: () => void rename(item, def) },
                  { id: 'icon', label: t('panel.changeIcon'), icon: 'cube', run: () => setPicking(item.id) },
                  { id: 'reset', label: t('panel.resetLook'), icon: 'refresh', disabled: !item.title && !item.icon, run: () => patch(item.id, { title: undefined, icon: undefined }) },
                ]}
                collapsed={!!item.collapsed}
                onCollapsedChange={(collapsed) => patch(item.id, { collapsed })}
                onRemove={() => onChange(latest.current.filter((i) => i.id !== item.id))}
              >
                {render(item)}
              </PanelFrame>
            </div>
          );
        })}
      </ResponsiveGridLayout>
      {pickingItem && pickingDef && (
        <IconPicker
          value={pickingItem.icon ?? pickingDef.icon}
          onPick={(icon) => { patch(pickingItem.id, { icon }); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
      {dialogs.element}
    </div>
  );
}
