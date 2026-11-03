import { expect, test } from 'bun:test';
import {
  applyDockSide, applyMainMenu, supportsDock, DEFAULT_LAYOUT, hasLabelledMenu, LAYOUTS, ORIGINAL_STRUCTURE, resolveLayout,
  PRESETS, differsFromPreset, layoutsConflicts, layoutsFromLegacy, legacyLayoutId, optionConflicts, resolveLayouts, validLayouts,
} from './layouts.ts';

test('every legacy layout id reduces to a conflict-free combination with the same structure', () => {
  for (const l of LAYOUTS) {
    const r = resolveLayouts(layoutsFromLegacy({ layout: l.id }));
    expect(layoutsConflicts(r)).toEqual([]);
    expect(r.structure).toEqual(l.structure);
    expect(legacyLayoutId(r)).toBe(l.id);
    expect(r.icons).toBe(l.icons);
  }
});

test('legacy mainMenu and dock migrate to nav toggles', () => {
  const s = layoutsFromLegacy({ layout: 'original', mainMenu: 'icons', dock: 'right' });
  expect(s).toEqual({ preset: 'original', nav: { dock: 'right' } });
  expect(layoutsFromLegacy({ layout: 'ribbon', mainMenu: 'icons' }).nav).toEqual({ labels: false });
  expect(layoutsFromLegacy({})).toEqual({ preset: 'ribbon' });
});

test('presets are conflict-free', () => {
  for (const p of PRESETS) expect(layoutsConflicts(resolveLayouts({ preset: p.id }))).toEqual([]);
});

test('Ledger needs a header navigation', () => {
  const sidebar = resolveLayouts({ preset: 'original' });
  expect(optionConflicts(sidebar, 'skin', 'ledger')).toEqual([
    { row: 'skin', option: 'ledger', blockedBy: 'navigation', reason: 'needsHeader' },
  ]);
  expect(optionConflicts(resolveLayouts({ preset: 'ribbon' }), 'skin', 'ledger')).toEqual([]);
});

test('Modeline needs bottom tabs and a status bar', () => {
  const r = resolveLayouts({ preset: 'original' });
  expect(optionConflicts(r, 'skin', 'modeline').map((c) => c.reason)).toEqual(['needsBottomTabs']);
  const bottom = resolveLayouts({ preset: 'original', nav: { tabBar: 'bottom' }, skin: 'modeline' });
  expect(optionConflicts(bottom, 'nav.tabBar', 'top')[0]?.reason).toBe('needsBottomTabs');
  expect(optionConflicts(bottom, 'nav.statusBar', 'false')[0]?.reason).toBe('needsStatusBar');
});

test('Islands is blocked by a header, in both directions', () => {
  expect(optionConflicts(resolveLayouts({ preset: 'ribbon' }), 'skin', 'islands')[0]?.reason).toBe('needsSidebar');
  const islands = resolveLayouts({ preset: 'original', skin: 'islands' });
  expect(optionConflicts(islands, 'navigation', 'header')).toEqual([
    { row: 'skin', option: 'islands', blockedBy: 'navigation', reason: 'needsSidebar' },
  ]);
  expect(optionConflicts(islands, 'navigation', 'atlas')).toEqual([]);
});

test('differsFromPreset lists the overriding rows', () => {
  expect(differsFromPreset({ preset: 'ribbon' })).toEqual([]);
  expect(differsFromPreset({ preset: 'bridge', views: { workbench: 'one-surface' } })).toEqual([]);
  expect(differsFromPreset({ preset: 'ribbon', skin: 'base', density: 'roomy', views: { rest: 'panes' }, nav: { dock: 'right' } }))
    .toEqual(['nav.dock', 'density', 'view.rest']);
});

test('resolveLayouts follows the preset for unknown ids; validLayouts drops unknown keys', () => {
  expect(resolveLayouts({ preset: 'nope', skin: 'zzz' as never }).navigation).toBe('header');
  expect(validLayouts({ preset: 'bridge', skin: 'zzz', density: 'roomy', extra: 1, views: { git: 'x', rest: 'panes' } }))
    .toEqual({ preset: 'bridge', density: 'roomy', views: { rest: 'panes' } });
  expect(validLayouts({ preset: 'nope' })).toBeUndefined();
  expect(validLayouts(null)).toBeUndefined();
});

test('layout ids are unique and include the default', () => {
  const ids = LAYOUTS.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(DEFAULT_LAYOUT);
});

test('resolveLayout falls back to the default', () => {
  expect(resolveLayout().id).toBe(DEFAULT_LAYOUT);
  expect(resolveLayout('nope').id).toBe(DEFAULT_LAYOUT);
  expect(resolveLayout('original').id).toBe('original');
});

test('hasLabelledMenu is true only for an expanded sidebar or a header nav', () => {
  expect(hasLabelledMenu(ORIGINAL_STRUCTURE)).toBe(false);
  expect(hasLabelledMenu({ ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' })).toBe(true);
  expect(hasLabelledMenu({ ...ORIGINAL_STRUCTURE, navPlacement: 'header' })).toBe(true);
});

test('applyMainMenu collapses an expanded sidebar for icons only', () => {
  const expanded = { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' as const };
  const icons = applyMainMenu(expanded, 'icons');
  expect(icons.sidebarMode).toBe('collapsed');
  expect(icons).not.toBe(expanded);
  expect(expanded.sidebarMode).toBe('expanded');
  expect(applyMainMenu(expanded, 'labels')).toBe(expanded);
  expect(applyMainMenu(expanded)).toBe(expanded);
  expect(applyMainMenu(ORIGINAL_STRUCTURE, 'icons')).toBe(ORIGINAL_STRUCTURE);
});

test('applyDockSide moves the sidebar and keeps the layout side when unset', () => {
  const right = applyDockSide(ORIGINAL_STRUCTURE, 'right');
  expect(right.sidebarSide).toBe('right');
  expect(applyDockSide(ORIGINAL_STRUCTURE)).toBe(ORIGINAL_STRUCTURE);
  expect(applyDockSide(ORIGINAL_STRUCTURE, 'left')).toBe(ORIGINAL_STRUCTURE);
});

test('header-nav layouts do not support the dock side', () => {
  expect(supportsDock('original')).toBe(true);
  expect(supportsDock('ribbon')).toBe(false);
});

test('placement defaults to tab, keeps hidden and side, drops unknown values and views', () => {
    expect(resolveLayouts({ preset: 'ribbon' }).placement).toEqual({ workbench: 'tab', rest: 'tab', terminal: 'tab', git: 'tab' });
    const v = validLayouts({ preset: 'ribbon', placement: { workbench: 'side', git: 'hidden', rest: 'bogus', dashboard: 'side' } });
    expect(v?.placement).toEqual({ workbench: 'side', git: 'hidden' });
    expect(resolveLayouts(v).placement.workbench).toBe('side');
});
