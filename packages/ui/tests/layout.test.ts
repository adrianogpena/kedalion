import { describe, expect, test } from 'bun:test';
import { ICON_SET_IDS, legacyLayoutId, ORIGINAL_STRUCTURE, resolveIconSetId, resolveLayout, resolveLayouts } from '@kedalion/server-core/layouts';
import { resolveShell } from '../src/layout';
import { AtlasAppFrame, BaseAppFrame, IslandsAppFrame } from '../src/components/AppFrame';
import { AtlasSidebar, BaseSidebar } from '../src/components/Sidebar';
import { IslandsStatusBar, ModelineStatusBar } from '../src/components/StatusBar';

describe('layouts', () => {
  test('resolveLayout falls back to the default layout', () => {
    expect(resolveLayout().id).toBe('ribbon');
    expect(resolveLayout('nope').id).toBe('ribbon');
  });

  test('original structure', () => {
    expect(resolveLayout('original').structure).toEqual(ORIGINAL_STRUCTURE);
  });

  test('per-view layouts resolve from the preset', () => {
    const ribbon = resolveLayouts({ preset: 'ribbon' });
    const bridge = resolveLayouts({ preset: 'bridge' });
    expect(ribbon.navigation).toBe('header');
    expect(bridge.navigation).toBe('header-command');
    expect(bridge.views.workbench).toBe('one-surface');
    expect(bridge.views.rest).toBe('panes');
    expect(ribbon.views.workbench ?? 'base').toBe('base');
    expect(legacyLayoutId(bridge)).toBe('bridge');
  });

  test('resolveIconSetId prefers a known override', () => {
    const layout = resolveLayout();
    expect(resolveIconSetId(layout)).toBe('atom');
    expect(resolveIconSetId(layout, 'nope')).toBe('atom');
    expect(resolveIconSetId(layout, ICON_SET_IDS[0])).toBe(ICON_SET_IDS[0]);
  });

  test('shells resolve from navigation and skin', () => {
    const atlas = resolveShell('atlas', 'base');
    expect(atlas.Frame).toBe(AtlasAppFrame);
    expect(atlas.Sidebar).toBe(AtlasSidebar);
    const islands = resolveShell('header', 'islands');
    expect(islands.Frame).toBe(IslandsAppFrame);
    expect(islands.Sidebar).toBe(BaseSidebar);
    expect(resolveShell('header', 'modeline').StatusBar).toBe(ModelineStatusBar);
    const both = resolveShell('atlas', 'islands');
    expect(both.Frame).toBe(IslandsAppFrame);
    expect(both.Sidebar).toBe(AtlasSidebar);
    expect(both.StatusBar).toBe(IslandsStatusBar);
    expect(resolveShell('sidebar', 'base').Frame).toBe(BaseAppFrame);
  });
});
