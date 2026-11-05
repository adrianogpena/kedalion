import { describe, expect, test } from 'bun:test';
import { setUiState } from './ui-state';
import { DEFAULT_SECTIONS, dockTool, hideSection, isTreeSection, loadSections, moveSection, moveWithin, normalizeSections, restoreAll, restoreSection, saveSections, sectionOrder, SECTIONS_KEY, toggleSection } from './sidebar-sections';


describe('sidebar sections', () => {
  test('toggle collapses and expands', () => {
    const a = toggleSection(DEFAULT_SECTIONS, 'tags');
    expect(a.collapsed).toContain('tags');
    expect(toggleSection(a, 'tags').collapsed).not.toContain('tags');
    expect(toggleSection(DEFAULT_SECTIONS, 'archived').collapsed).not.toContain('archived');
  });

  test('hide, restore one, restore all', () => {
    const a = hideSection(hideSection(DEFAULT_SECTIONS, 'tags'), 'usage');
    expect(a.hidden).toEqual(['changes', 'tags', 'usage']);
    expect(restoreSection(a, 'tags').hidden).toEqual(['changes', 'usage']);
    expect(restoreAll(a).hidden).toEqual([]);
  });

  test('move sets an explicit order', () => {
    expect(sectionOrder(DEFAULT_SECTIONS)).toEqual(['sessions', 'changes', 'tags', 'archived', 'usage']);
    expect(sectionOrder(DEFAULT_SECTIONS, true)[0]).toBe('usage');
    const a = moveSection(DEFAULT_SECTIONS, 'usage', 0);
    expect(a.order).toEqual(['usage', 'sessions', 'changes', 'tags', 'archived']);
    expect(moveSection(a, 'usage', 99).order).toEqual(['sessions', 'changes', 'tags', 'archived', 'usage']);
  });

  test('moveWithin keeps the tree and island areas apart', () => {
    const a = moveWithin(DEFAULT_SECTIONS, 'tags', 0);
    expect(sectionOrder(a).filter(isTreeSection)).toEqual(['tags', 'sessions', 'archived']);
    expect(sectionOrder(a).filter((x) => !isTreeSection(x))).toEqual(['changes', 'usage']);
  });

  test('normalize drops unknown ids and completes the order', () => {
    expect(normalizeSections({ order: ['tags', 'bogus'], collapsed: [], hidden: ['x', 'files', 'usage'] })).toEqual({ order: ['tags', 'sessions', 'changes', 'archived', 'usage'], collapsed: [], hidden: ['usage'], tools: [] });
    expect(normalizeSections(null)).toEqual(DEFAULT_SECTIONS);
  });

  test('docked tools: dock, order, undock, old state without tools', () => {
    const a = dockTool(DEFAULT_SECTIONS, 'notes');
    expect(a.tools).toEqual(['notes']);
    expect(sectionOrder(a).at(-1)).toBe('tool:notes');
    expect(hideSection(moveSection(a, 'tool:notes', 0), 'tool:notes')).toEqual({ ...DEFAULT_SECTIONS, order: sectionOrder(DEFAULT_SECTIONS) });
    expect(dockTool(DEFAULT_SECTIONS, 'changes').hidden).toEqual([]);
    expect(normalizeSections({ collapsed: [], hidden: [] }).tools).toEqual([]);
    expect(normalizeSections({ tools: ['notes', 'bogus'], order: ['tool:notes', 'tool:task'] }).order?.[0]).toBe('tool:notes');
    expect(normalizeSections({ tools: ['notes'], order: ['tool:task'] }).order).not.toContain('tool:task');
  });

  test('save and load round trip; a bad stored value falls back to the defaults', () => {
    expect(loadSections()).toEqual(DEFAULT_SECTIONS);
    const a = hideSection(DEFAULT_SECTIONS, 'tags');
    saveSections(a);
    expect(loadSections()).toEqual(a);
    setUiState(SECTIONS_KEY, { collapsed: 'x', hidden: 5, tools: 'y' });
    expect(loadSections()).toEqual({ collapsed: [], hidden: [], tools: [] });
  });
});
