// Raw buttons: a generic button is `Button`/`IconButton`/`buttonClass` from @kedalion/ui (docs/DESIGN.md, Buttons).
// A bare `<button>` is only for controls that are not generic buttons (tabs, tree rows, menu items, chips, swatches, nav items).
// Each file lists how many it may hold; a new raw button, or one in a new file, fails `bun run typecheck`. Adding an entry
// means the control is not a generic button: say why in the commit.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Violation } from './check-boundaries';

export const RAW_BUTTON_RULE = 'raw button: use Button/IconButton from @kedalion/ui (or add the file to RAW_BUTTONS in scripts/check-buttons.ts if it is a tab, row, menu item or chip)';
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.build']);
const MARKER = /<button\b|createElement\(\s*['"]button['"]/g;

const RAW_BUTTONS: Record<string, number> = {
  'packages/ui/src/design.tsx': 5,
  'packages/view-git/src/git/ReadThroughView.tsx': 2,
  'app/web/src/screens/SettingsModal.tsx': 10,
  'packages/editor/src/MarkdownToc.tsx': 2,
  'packages/view-browser/src/Favorites.tsx': 1,
  'packages/view-grid/src/dashboard/DashboardScreen.tsx': 1,
  'packages/view-grid/src/FolderField.tsx': 2,
  'packages/view-grid/src/panels/tickets/NoteTemplatesDialog.tsx': 1,
  'packages/view-grid/src/panels/tickets/TicketOverview.tsx': 3,
  'packages/editor/src/MarkdownView.tsx': 1,
  'packages/view-grid/src/panels/meeting/MeetingPanel.tsx': 1,
  'packages/editor/src/RequestEditor.tsx': 1,
  'packages/editor/src/rich/headingLinks.ts': 1,
  'packages/editor/src/ResponseView.tsx': 1,
  'packages/editor/src/SqlSteps.tsx': 8,
  'packages/editor/src/SqliteView.tsx': 1,
  'packages/editor/src/rich/HeadingPicker.tsx': 1,
  'packages/editor/src/rich/Toolbar.tsx': 1,
  'packages/terminal/src/TerminalPane.tsx': 2,
  'packages/ui/src/components/AppearanceFields.tsx': 3,
  'packages/ui/src/components/Breadcrumbs.tsx': 6,
  'packages/ui/src/components/CommandPalette.tsx': 2,
  'packages/ui/src/components/ContextMenu.tsx': 1,
  'packages/ui/src/components/FileDialog.tsx': 4,
  'packages/ui/src/components/HeaderNav.tsx': 2,
  'packages/ui/src/components/IconPicker.tsx': 1,
  'packages/ui/src/components/JsonTree.tsx': 2,
  'packages/ui/src/components/KeybindingsEditor.tsx': 1,
  'packages/ui/src/components/LogBookmarkMenu.tsx': 1,
  'packages/ui/src/components/LogHighlightBar.tsx': 1,
  'packages/ui/src/components/LogView.tsx': 1,
  'packages/ui/src/components/ProjectPicker.tsx': 5,
  'packages/ui/src/components/Resource.tsx': 1,
  'packages/ui/src/components/SettingFields.tsx': 2,
  'packages/ui/src/components/Sidebar.tsx': 1,
  'packages/ui/src/components/StatusBar.tsx': 1,
  'packages/ui/src/components/Tabs.tsx': 1,
  'packages/ui/src/components/TabWorkspace.tsx': 1,
  'packages/view-agents/src/web/AccountPicker.tsx': 2,
  'packages/view-grid/src/panels/pods/PodEntryFields.tsx': 1,
  'packages/view-agents/src/web/AccountsSettings.tsx': 2,
  'packages/view-agents/src/web/AddProject.tsx': 1,
  'packages/view-agents/src/web/GroupSummary.tsx': 1,
  'packages/view-agents/src/web/MoveToFolder.tsx': 1,
  'packages/view-agents/src/web/Sidebar.tsx': 5,
  'packages/view-agents/src/web/SidebarSection.tsx': 1,
  'packages/view-agents/src/web/SkillsPanel.tsx': 1,
  'packages/view-agents/src/web/StoppedCard.tsx': 1,
  'packages/view-agents/src/web/StoppedPane.tsx': 1,
  'packages/view-agents/src/web/TrajectoryTab.tsx': 2,
  'packages/view-agents/src/web/trajectory/FilesView.tsx': 1,
  'packages/view-agents/src/web/trajectory/StatsView.tsx': 1,
  'packages/view-agents/src/web/trajectory/Timeline.tsx': 1,
  'packages/view-agents/src/web/TrashPanel.tsx': 1,
  'packages/view-agents/src/web/UsageView.tsx': 1,
  'packages/view-agents/src/web/panels/changes/index.tsx': 1,
  'packages/view-agents/src/web/panels/review/index.tsx': 1,
  'packages/view-agents/src/web/panels/workflows/index.tsx': 1,
  'packages/view-agents/src/web/workspace/ProjectWorkspace.tsx': 1,
  'packages/view-explorer/src/ExplorerScreen.tsx': 1,
  'packages/view-explorer/src/explorer/ProjectSearch.tsx': 2,
  'packages/view-explorer/src/explorer/SqlPanel.tsx': 1,
  'packages/view-explorer/src/explorer/TreePane.tsx': 2,
  'packages/view-explorer/src/markdown-settings.ts': 1,
  'packages/view-explorer/src/settings/cards.tsx': 1,
  'packages/view-git/src/GitScreen.tsx': 4,
  'packages/view-git/src/git/HistoryPanel.tsx': 4,
  'packages/view-rest/src/RestScreen.tsx': 1,
  'packages/view-rest/src/rest/EnvironmentsDialog.tsx': 1,
  'packages/view-rest/src/rest/HistoryPanel.tsx': 1,
  'packages/view-rest/src/rest/RestTabBar.tsx': 1,
  'packages/view-workbench/src/workbench/HistoryPanel.tsx': 1,
  'packages/view-workbench/src/workbench/SchemaPanel.tsx': 4,
};

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else if (SOURCE.test(e.name) && !e.name.endsWith('.d.ts') && !TEST_FILE.test(e.name)) yield join(dir, e.name);
  }
}

/** Files with more raw `<button>` than RAW_BUTTONS allows. `Button.tsx` implements the component and is exempt. */
export function findRawButtons(root: string, allowed: Record<string, number> = RAW_BUTTONS): Violation[] {
  const violations: Violation[] = [];
  for (const top of ['apps', 'packages']) {
    const dir = join(root, top);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(root, file).split(sep).join('/');
      if (rel === 'packages/ui/src/components/Button.tsx') continue;
      const count = (readFileSync(file, 'utf8').match(MARKER) ?? []).length;
      const max = allowed[rel] ?? 0;
      if (count > max) violations.push({ file: rel, specifier: `${count} raw button(s), ${max} allowed`, rule: RAW_BUTTON_RULE });
    }
  }
  return violations;
}

export function formatRawButton(v: Violation): string {
  return `${v.file}: ${v.specifier}; ${v.rule}`;
}

if (import.meta.main) {
  const violations = findRawButtons(join(import.meta.dir, '..'));
  for (const v of violations) console.error(formatRawButton(v));
  if (violations.length) process.exit(1);
  console.log('raw buttons ok');
}
