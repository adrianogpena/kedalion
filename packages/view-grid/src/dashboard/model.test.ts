import { describe, expect, test } from 'bun:test';
import { CLOCK_SPEC } from '../clock-fields';
import { activeLayout, defaultLayouts, itemFromPreset, keepViewState, layoutsOrDefault, sameLayout, newLayoutId, newPresetId, presetFromItem, validDashboardLayouts, validDashboardPresets } from './model';

const kinds = { clock: CLOCK_SPEC };
const item = { id: 'clock', kind: 'clock', x: 0, y: 0, w: 3, h: 4 };
const layout = (id: string, name = 'L', items: unknown[] = []) => ({ id, name, items });

describe('validDashboardLayouts', () => {
  test('accepts a valid state and cleans items', () => {
    const v = validDashboardLayouts({ active: 'b', layouts: [layout('a'), layout('b', ' Two ', [{ ...item, config: { hour12: 'x', junk: 1 } }])] }, kinds);
    expect(v?.active).toBe('b');
    expect(v?.layouts[1]?.name).toBe('Two');
    expect(v?.layouts[1]?.items[0]?.config).toEqual({ timeZone: '', hour12: false, showSeconds: true, showDate: true, layout: 'digital' });
  });

  test('rejects bad shapes', () => {
    expect(validDashboardLayouts(null, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'zz', layouts: [layout('a')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a'), layout('a')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', '')] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', 'x'.repeat(41))] }, kinds)).toBeNull();
    expect(validDashboardLayouts({ active: 'a', layouts: [layout('a', 'L', [{ ...item, kind: 'nope' }])] }, kinds)).toBeNull();
  });

  test('allows 20 layouts, not 21', () => {
    const many = (n: number) => ({ active: 'l0', layouts: Array.from({ length: n }, (_, i) => layout(`l${i}`)) });
    expect(validDashboardLayouts(many(20), kinds)).not.toBeNull();
    expect(validDashboardLayouts(many(21), kinds)).toBeNull();
  });
});

describe('helpers', () => {
  test('default, fallback, active and new id', () => {
    const d = defaultLayouts('My dashboard');
    expect(d.layouts).toEqual([{ id: 'default', name: 'My dashboard', items: [] }]);
    expect(layoutsOrDefault(undefined, kinds, 'My dashboard')).toEqual(d);
    expect(activeLayout({ active: 'x', layouts: d.layouts }).id).toBe('default');
    expect(newLayoutId(d.layouts)).not.toBe('default');
  });
});

describe('validDashboardPresets', () => {
  const preset = { id: 'p1', name: 'Lisbon', kind: 'clock', config: { timeZone: 'Europe/Lisbon', junk: 1 }, w: 3, h: 4 };

  test('cleans config and drops unknown kinds and bad entries', () => {
    const v = validDashboardPresets([preset, { ...preset, id: 'p2', kind: 'nope' }, { ...preset, id: 'p3', name: '' }, { ...preset, id: 'p1' }, 5], kinds);
    expect(v).toEqual([{ id: 'p1', name: 'Lisbon', kind: 'clock', config: { timeZone: 'Europe/Lisbon', hour12: false, showSeconds: true, showDate: true, layout: 'digital' }, w: 3, h: 4 }]);
  });

  test('rejects a non-list and more than 50', () => {
    expect(validDashboardPresets({}, kinds)).toBeNull();
    expect(validDashboardPresets(Array.from({ length: 51 }, (_, i) => ({ ...preset, id: `p${i}` })), kinds)).toBeNull();
  });
});

describe('presets to items', () => {
  const def = { id: 'clock', title: 'Clock', icon: 'sun' as const, defaultSize: { w: 3, h: 4 }, minW: 2, minH: 2 };

  test('presetFromItem keeps kind, config, title, icon and size', () => {
    const p = presetFromItem({ ...item, config: { timeZone: 'Europe/Lisbon' }, title: 'Lisbon', icon: 'home' as const }, 'preset-1', ' Lisbon clock ');
    expect(p).toEqual({ id: 'preset-1', name: 'Lisbon clock', kind: 'clock', config: { timeZone: 'Europe/Lisbon' }, title: 'Lisbon', icon: 'home', w: 3, h: 4 });
  });

  test('itemFromPreset adds an item with the preset size, title, icon and config', () => {
    const next = itemFromPreset([], { id: 'p', name: 'n', kind: 'clock', config: { timeZone: 'Europe/Lisbon' }, title: 'Lisbon', icon: 'home' as const, w: 5, h: 3 }, def);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: 'clock', w: 5, h: 3, title: 'Lisbon', icon: 'home', config: { timeZone: 'Europe/Lisbon' } });
  });

  test('itemFromPreset clamps to the grid minimum', () => {
    const next = itemFromPreset([], { id: 'p', name: 'n', kind: 'clock', w: 1, h: 1 }, def);
    expect(next[0]).toMatchObject({ w: 1, h: 2 });
  });

  test('newPresetId avoids used ids', () => {
    expect(newPresetId([{ id: 'preset-1', name: 'a', kind: 'clock', w: 1, h: 1 }])).toBe('preset-2');
  });
});

describe('sameLayout and keepViewState', () => {
  const a = { ...item, config: { text: 'a' } };

  test('config and collapsed do not make a layout differ, geometry and title do', () => {
    expect(sameLayout([a], [{ ...a, config: { text: 'b' }, collapsed: true }])).toBe(true);
    expect(sameLayout([a], [{ ...a, w: 5 }])).toBe(false);
    expect(sameLayout([a], [{ ...a, title: 'X' }])).toBe(false);
  });

  test('keepViewState restores geometry but keeps config and collapsed of matching ids', () => {
    const live = [{ ...a, x: 4, config: { text: 'new' }, collapsed: true }, { ...item, id: 'added', x: 8 }];
    const out = keepViewState([a, { ...item, id: 'removed', config: { text: 'r' } }], live);
    expect(out[0]).toEqual({ ...a, config: { text: 'new' }, collapsed: true });
    expect(out[1]?.config).toEqual({ text: 'r' });
    expect(out).toHaveLength(2);
  });
});
