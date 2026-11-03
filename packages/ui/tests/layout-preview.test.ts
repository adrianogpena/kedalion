import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveLayouts, type ResolvedLayouts } from '@kedalion/server-core/layouts';
import { NavigationPreview, ViewLayoutPreview } from '../src/components/LayoutPreview';

const base = resolveLayouts({ preset: 'ribbon' } as any);
const withNav = (navigation: ResolvedLayouts['navigation'], nav: Partial<ResolvedLayouts['nav']> = {}): ResolvedLayouts => ({
  ...base,
  navigation,
  nav: { ...base.nav, ...nav },
});
const nav = (r: ResolvedLayouts) => renderToStaticMarkup(createElement(NavigationPreview, { resolved: r }));
const view = (v: 'git' | 'workbench' | 'rest', layout: string) =>
  renderToStaticMarkup(createElement(ViewLayoutPreview, { view: v, layout, resolved: base }));

describe('NavigationPreview', () => {
  test('header shows a header strip and no rail', () => {
    const html = nav(withNav('header'));
    expect(html).toContain('lp-nav-header');
    expect(html).toContain('lp-header');
    expect(html).not.toContain('lp-rail ');
  });
  test('header-command adds command bar and activity strip', () => {
    const html = nav(withNav('header-command'));
    expect(html).toContain('lp-command');
    expect(html).toContain('lp-activity');
  });
  test('sidebar rail follows dock, labels and brand', () => {
    const html = nav(withNav('sidebar', { dock: 'right', labels: true, brand: true }));
    expect(html).toContain('lp-rail-right');
    expect(html).toContain('lp-rail-wide');
    expect(html).toContain('lp-brand');
    expect(nav(withNav('sidebar', { dock: 'left', labels: false, brand: false }))).not.toContain('lp-brand');
  });
  test('atlas has a status row with tools', () => {
    const html = nav(withNav('atlas', { statusBar: true }));
    expect(html).toContain('lp-rail-atlas');
    expect(html).toContain('lp-status-atlas');
  });
  test('tab bar position and status bar toggle', () => {
    expect(nav(withNav('header', { tabBar: 'bottom' }))).toContain('lp-tabbar-bottom');
    expect(nav(withNav('header', { tabBar: 'top' }))).toContain('lp-tabbar-top');
    expect(nav(withNav('header', { statusBar: false }))).not.toContain('lp-status');
  });
  test('skin and density are exposed', () => {
    const html = nav({ ...base, skin: 'blueprint', density: 'compact' });
    expect(html).toContain('data-skin="blueprint"');
    expect(html).toContain('lp-density-compact');
  });
});

describe('ViewLayoutPreview', () => {
  test('workbench', () => {
    expect(view('workbench', 'base')).toContain('lp-wb-base');
    expect(view('workbench', 'one-surface')).toContain('lp-wb-one');
  });
  test('rest', () => {
    expect(view('rest', 'base')).toContain('lp-rest-base');
    expect(view('rest', 'panes')).toContain('lp-rest-panes');
    expect(view('rest', 'panes')).toContain('lp-grip');
  });
  test('git', () => {
    expect(view('git', 'base')).toContain('lp-git-base');
    expect(view('git', 'read-through')).toContain('lp-git-rt');
    expect(view('git', 'read-through')).toContain('lp-drawer');
  });
});
