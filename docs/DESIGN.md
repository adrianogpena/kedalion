# Kedalion design standard

The default look for every view. A view may have its own content (a diff, a terminal, a graph); the generic parts below (buttons, headers, rows, tabs, states, menus) look and behave the same everywhere.

Sources of truth: colour tokens in `packages/server-core/src/palettes.ts` (`TOKENS`, `PALETTES`), size variables and shared classes in `packages/ui/src/styles.css`, shared components in `packages/ui/src/components/`. Layouts (`packages/ui/src/layouts/*.css`) may restyle the shared classes; views never do.

Items marked **(proposed)** do not exist yet; see [Alignment backlog](#alignment-backlog).

## Rules

1. Colours only through `var(--token)`. No hex, no `rgb()`, no fallback such as `var(--x, #fff)`. Every token used must exist in `TOKENS`.
2. Sizes through the size variables: `--radius-*`, `--fs-*`, `--control-h*`, `--space-*`, shell sizes. No literal px for radius, font size or control height.
3. Fonts: `var(--font-sans)` for UI, `var(--font-mono)` for code, paths and values. No other family.
4. A generic piece uses the shared class or component. A view-specific class may add to it (`.btn.wb-run`), never re-create it.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `--bg-sunken` < `--bg` < `--panel` / `--bg-elev` < `--panel-2` | Page, panes, cards, raised controls |
| Interaction | `--hover`, `--selected`, `--side-active`, `--accent-soft` | Hover, selected row, active nav item, active toggle |
| Text | `--text` > `--text-2` > `--text-3` | Body, secondary, captions and placeholders |
| Borders | `--border`, `--border-soft`, `--row-border`, `--keycap` | Controls, dividers, table rows, key caps |
| Accent | `--accent`, `--accent-2` (hover), `--accent-soft`, `--ink-on-accent` | Primary action, selection, focus |
| Status | `--ok --warn --err --info --debug` + `-soft`, `--muted-soft`, `--ink-on-err` | Badges, banners, danger |
| Elevation | `--shadow`, `--backdrop` | Floating layers only |

Size scales (`styles.css` `:root`):

- Radius: `2xs 2 · xs 4 · sm 5 · md 6 · lg 7 · xl 8 · 2xl 9 · 3xl 10 · 4xl 12 · 5xl 14`. Keycaps/badges xs–sm, chips md, buttons lg–xl, cards 2xl–4xl, modals/popovers 5xl.
- Font size: `--fs-2xs 10.5` captions, `--fs-xs 11` meta, `--fs-sm 12` small controls, `--fs-md 13` body, `--fs-lg 14`–`--fs-2xl 16` titles.
- Control height: `--control-h 30` · `-sm 28` · `-xs 26` · `-2xs 24` · `-3xs 22`.
- Space: `2 4 6 8 10 12 16 24` (`--space-N`).

## Buttons

Use `Button` and `IconButton` from `@kedalion/ui` (`packages/ui/src/components/Button.tsx`), never a bare `<button>` with its own class. They render the `btn` classes below; `buttonClass(variant, size)` gives the class string where a component cannot be used (a `<label>` or `<a>` styled as a button).

```tsx
<Button variant="primary" size="sm" icon="play" onClick={run}>Run</Button>
<Button size="sm" variant="ghost" icon="history" pressed={open} onClick={toggle}>History</Button>
<IconButton icon="refresh" label="Refresh" onClick={reload} />
<ToolbarSep />
```

One look per role (`variant`):

| Role | `variant` | Background | Border | Text | Hover | Where |
|---|---|---|---|---|---|---|
| Default (secondary) | `default` | `--panel-2` | `--border` | `--text` | bg `--hover`, border `--text-3` | Secondary actions, dialog Cancel |
| Primary | `primary` | `--accent` | `--accent` | `--ink-on-accent`, 600 | `--accent-2` | The one main action of a dialog, toolbar, row or empty state. At most one per area |
| Ghost | `ghost` | transparent | transparent | `--text-2` | bg `--hover`, text `--text` | Tools, view toggles, low-weight actions |
| Danger | `danger` | `--err-soft` | transparent | `--err`, 600 | bg `--err`, text `--ink-on-err` | Delete, discard, stop, cancel a run |
| Toggle on | any + `pressed` | `--accent-soft` | accent 40% | `--accent` | | A view or mode that is on (`aria-pressed="true"`) |
| Icon only | `IconButton` (ghost, sm) | per role | | | | Square; `label` is the tooltip and accessible name |

Sizes (`size`):

| Size | Height | Padding | Radius | Font | Icon | Where |
|---|---|---|---|---|---|---|
| `md` | `--control-h` 30 | `0 11px` | `--radius-xl` | inherit | 14 | Dialogs, forms, empty states |
| `sm` | `--control-h-sm` 28 | `0 9px` | `--radius-lg` | `--fs-sm` | 14 | Page header, toolbars, pane heads |
| `xs` | `--control-h-3xs` 22 | `0 6px` | `--radius-md` | `--fs-xs` | 12 | Actions inside rows, cards and section heads |

States, built into the classes:

- Hover: as in the table, `transition: background .12s, border-color .12s`.
- Disabled: `disabled` → `opacity: .5; cursor: not-allowed`; no hover change.
- Focus: `:focus-visible` → `outline: 2px solid var(--accent); outline-offset: 1px`.
- Toggle: `pressed` → accent on `--accent-soft`.

`bun run typecheck` fails on a raw `<button>` beyond the per-file counts in `scripts/check-buttons.ts` (`RAW_BUTTONS`: tabs, tree rows, menu items, chips, nav items). A new generic button uses `Button`/`IconButton`; a new non-button control adds its file there.

Every button has a text label or an icon plus `title`; actions get an icon when one exists (`play` start/run, `square` stop/cancel, `rotate-ccw` restart/rollback, `check` commit, `log` logs, `copy`, `download` export).

Dialog footers: buttons right-aligned, Cancel (`default`) then `primary` or `danger`. Button text names the result ("Delete branch"), not "OK".

### Toolbars

A toolbar is one row of `sm` buttons split into groups by `ToolbarSep`, in this order: source/context → main actions (primary first) → state actions → view toggles → output actions (export, copy). Only the main action is `primary`; secondary actions in the same group are `default`; tools and toggles are `ghost`. Rarely used actions go in a "more" `ContextMenu`.

Reference: the Workbench header (`packages/view-workbench/src/WorkbenchScreen.tsx`, `PageHead`).

### Do not

The old Agents Run panel rows were the example to avoid: `<button className="agents-run-btn">` with only `cursor: pointer`, so Start, Stop and Logs rendered as identical unstyled grey boxes with no role, size, icon, hover or focus. Fixed version: `xs` buttons, `primary` Start, `danger` Stop, `default` Restart, `ghost` + `pressed` Logs (`packages/view-agents/src/web/panels/run/index.tsx`).

### Related controls

| Control | Class | Use |
|---|---|---|
| Filter chip | `chip`, `chip-on` | Toggleable filters in a row (`.chips`) |
| Segmented control **(proposed)** | `seg` + `Button pressed` | 2–4 exclusive modes (replaces `.agents-mode`, `.diff-view-bar`) |
| Link | `setting-link` / `breadcrumbs-seg` | Navigation inside text |

## Generic pieces

| Piece | Use | Not |
|---|---|---|
| Screen root | `content screen-edges` | Bare `content` or `screen-edges` alone |
| Page header | `PageHead` (title, meta, actions on one line) | A row of 15 buttons; overflow goes in a "more" `ContextMenu` |
| Pane / panel head | `.panel-head`, height `--panel-head-h`, `.mono-label` caption, ghost `btn-sm` actions | Hard-coded padding (`agents-panel-head`), borrowing another view's class (`xp-pane` in Git) |
| Toolbar inside a pane | one class **(proposed: `.toolbar`)**, padding `--space-6 --space-8`, `sm` buttons grouped by `ToolbarSep` (see [Toolbars](#toolbars)), one row | `fd-toolbar`, `log-toolbar`, `xp-find`, `rest-history-head`, `wb-schema-head`, `agents-sidebar-head` each with own padding |
| Tree / list | `TreeView`; flat lists use `.tree-row` + `useRovingList` | Own row classes with own hover/selected |
| Row | min-height `--control-h-3xs`, hover `--hover`, selected `--selected`, focus `inset 0 0 0 1px var(--accent)` | Selected shown with `--hover` (REST) or a right bar (Agents) |
| Workspace tabs | `TabWorkspace` / `BaseTabBar` (`.tab-chip`) | |
| Section tabs | `.req-tab` (underline) | `sqlsteps-tab`, `agents-skills-tab`, `agents-panel-tabs button` |
| Split | `SplitView` | Own flex layouts with drag handles |
| Empty | `Empty` with the next action as a button | `<p class="muted">`, `git-reason`, `wb-plan-empty`, Agents `EmptyState`/`EmptyCard` |
| Loading | `Spinner` (`small` inside panes) | |
| Error | `ErrorBanner` (`compact` inside panes, full in a whole pane) with retry | |
| Badge / count | `Badge` with a tone | `git-count`, `tree-badge`, `sqlsteps-count`, `xp-find-count`, `agents-badge`, `agents-pill` |
| Menus | `ContextMenu` for right-click and "more" buttons | Hand-built `menu-wrap`/`menu` (Git, Explorer `TreePane`) |
| Dialogs | `Modal`, `dialogs.*` + `DialogHost` | Native dialogs |
| Toast | `useToast` | |
| Inputs | `.input` / `select` from `styles.css`, height `--control-h-xs` | Raw `<select>` without the shared class |
| Caption | `.mono-label` | Literal small uppercase text |
| Keyboard | `useRovingList` for every list; Escape closes | Lists without arrow keys (REST, Workbench) |

## Icons

`Icon` with a size from this scale (`Button` picks it): 12 inside `xs` buttons and badges, 14 in buttons and rows (default), 16 in the header and nav, 20 in large tiles, 28 in empty states. 13, 15, 18 and 22 are retired.

## Layers and motion **(proposed tokens)**

| Token | Value | Use |
|---|---|---|
| `--z-sticky` | 1 | Sticky table and list heads |
| `--z-raised` | 5 | Overlays inside a pane (toc rail, resize handle) |
| `--z-popover` | 20 | Dropdowns, tooltips, editor toolbar |
| `--z-modal` | 50 | Modal and its backdrop |
| `--z-toast` | 65 | Toasts |
| `--z-menu` | 70 | Context menus (above modals) |
| `--dur-fast` / `--dur` | 120ms / 200ms | Hover / open, expand |
| `--opacity-disabled` | .5 | Every disabled control |

Motion stays inside `@media (prefers-reduced-motion: no-preference)`. Popovers use `--shadow`; panels sit flat on borders.

## Layouts

A **layout** is a preset of independent choices (`PRESETS`, `resolveLayouts` in `packages/server-core/src/layouts.ts`, chosen in Settings > Appearance > Layout): a navigation, nav toggles, a skin, a density and one arrangement per view (`VIEW_LAYOUTS`). Ribbon is the default preset.

- **Navigation**: the main menu, document tab bar and status bar area (`NavigationId`: header, header-command, sidebar, atlas). "Shell" is not used for it, since it reads as the terminal.
- **Skin**: tokens, fonts, icons, chrome CSS (`SkinId`). Can sit on any navigation.
- **Density**: `normal`, `compact` or `roomy`.
- **Per-view layout**: Git, Workbench and REST each pick Base or their own arrangement.
- **Skin test**: a change is skin when tokens, CSS variables, font or icon swaps and component props can do it. Moving or adding panels is structure.

Skin CSS (`packages/ui/src/layouts/<skin>.css`) is scoped under `:root[data-skin='<id>']` (navigation under `data-nav`, density under `data-density`) and restyles shared classes; views never do. Other layouts must look unchanged when one is added.

### Core behaviours

Arrangement and look are free; these hold in every layout:

1. Every view (Dashboard, Explorer, Git, Workbench, REST, Terminal, Browser, Agents) keeps its capabilities, data and actions; a layout may rearrange them, not drop one.
2. Every view and command is reachable; the navigation form is free.
3. Command palette with all commands; every action works from the keyboard.
4. All settings reachable with instant save; layout, palette, dark/light, icons and language can be chosen.
5. Server APIs, stored data, `~/.kedalion` files and ports never change with a layout.
6. en and pt-BR; all strings in the i18n files.
7. Visible focus, keyboard navigation, contrast at least 4.5:1, reduced motion.
8. Zoom 0.5-2, narrow panes and a small window work.
9. Shared dialogs (no native dialogs), toasts and context menus.
10. Dark and light both work.
11. Default shortcuts are the same everywhere; a layout adds one only for a function that exists only in it.
12. Remembered per-view state (last file, scroll position) works.

Layout-only extras are fine when they touch none of these.

### Adding and previewing a layout

Steps are in [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-layout). To compare it with the current look, offer it in the preview run below.

### Preview switchers (`bun run dev:design`)

The run sets `VITE_KEDALION_DESIGN`; without it nothing below renders. The "Design" chip (`DesignSwitcher`, `packages/ui/src/design.tsx`) has:

- **Layout**: `current` or a whole layout listed in `OFFERED_LAYOUTS`. Read with `useDesignLayout()`; key `kedalion.design.layout` in `localStorage`. A stored id that is not offered gives `current`.
- **Skin**: detail changes on the current structure, `OFFERED_SKINS` maps each skin to the views that support it. Read with `useDesignSkin(view)`; key `kedalion.design.skin`. A view that does not support the skin falls back to `current`.
- Per-view variants (`useDesign`, `kedalion.design.<view>`): see [design-explore.md](design-explore.md).

### Lifecycle

- **Preview**: offered only behind the design flag; placeholders allowed, wiring comes after the pick.
- **Shipped**: listed in `SELECTABLE_LAYOUT_IDS` and so in Settings.
- **Retired**: removed from Settings and the offered lists; the file may stay as a starting point or be deleted.

Assets: fonts bundled, licensed and small (single offline exe); icon sets cover all of `IconName` (`icons.test.ts`); a new palette needs every token (`palettes.test.ts`). `scripts/check-contrast.ts` checks palette contrast.

## Alignment backlog

Found by the audit of 2026-10-21. Fixing these makes the views match this document.

**Buttons**
- Migrate to `Button`/`IconButton`: about 449 raw `<button>` in 109 files, about 200 not using `btn`. Done: Workbench header, Agents Run panel.
- Generic `button`, `select` and tab strips have no `:focus-visible`; other focus styles mix 1px/2px outlines and inset shadows.
- Agents has its own button set: `.agents-empty-btn` (primary, h28 r6, `#fff` fallback), `.agents-bar-btn` (h22), `.agents-output-btn` (h24, `#8884`), `.agents-icon-btn`, `.agents-head-btn` (24px), `.agents-section-btn` (22px), `.agents-node-actions button` (20px). Replace with `Button`/`IconButton` `xs`.
- `.panel-btn`, `.resource-btn`, `.log-icon-btn` are three copies of one rule (`styles.css` 555, 616, 922).
- Radii used on buttons: 3, 4, 6px literal, 999px, and five different tokens.
- Disabled opacity varies from .4 to .55; Agents buttons have no disabled state.

**Tokens and type**
- Hard-coded colours: Agents panels (`panels/output/style.css` 30, `sidebar.css` 10, `review/style.css` 9, `run`, `usage`), `TerminalSchemes.tsx` (these two may be intentional palettes).
- Undefined tokens with fallbacks: `--danger`, `--bg-elevated`, `--surface`, `--surface-raised`, `--text-dim`, `--mono`, `--radius-6`. Agents also uses `--ink`, `--ink-muted` beside `--text`/`--text-2`.
- 53 literal font sizes (9px to 28px, plus `.7em`–`.9em` in Agents panels); 56 literal radii, mostly in `view-agents`.
- Other fonts: `Georgia` (`editor/rich/toolbar.css:12`), `ui-monospace`/`monospace`/`JetBrains Mono` in Agents panels, literal Geist Mono stack at `styles.css:139`.
- Popover shadows not using `--shadow`: `styles.css:1201`, `:1378`, `view-agents/src/styles.css:258`; `review/style.css:24` backdrop not using `--backdrop` and `z-index: 1000`.
- Agents defines its own motion tokens (`--agents-fast`, `--agents-normal`).

**Views**
- Rows: four implementations (Explorer `TreeView`, Git `tree-row git-row`, Agents `agents-session`/`agents-node`, REST `rest-item`, Workbench `wb-schema-table`) with different heights and selected styles.
- Page header: only REST and Workbench use `PageHead`; Workbench puts about 15 buttons in it.
- Git reuses Explorer's `.xp-pane` instead of a shared pane class.
- Git and Explorer `TreePane` build dropdown menus by hand instead of `ContextMenu`.
- `Empty` is used only once (Git); other views use their own empty markup.
- Five tab styles (`tab-chip`, `req-tab`, `sqlsteps-tab`, `agents-skills-tab`, `header-tab`).
- Six toolbar classes with different padding.
- REST and Workbench lists have no `useRovingList`.
- `.fd-head` is 26px while `--panel-head-h` is 40.

**Also worth checking**
- Every layout in `packages/ui/src/layouts/` after changing a shared class: the layouts restyle `.btn` and `.tab-chip`.
- Light theme contrast of `--text-3` and of `-soft` backgrounds on `--panel-2`.
- The build templates (`packages/build/template`, `packages/build/view-template`) so new apps and views start from this standard.
- An automated check (like the native-dialog check in `bun run typecheck`) that fails on hex colours and undefined `var(--…)` names in CSS.
