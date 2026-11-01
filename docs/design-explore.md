# Design explore: A, B, C against the current design

Run it with `bun run dev:design`. The "Design" chip (bottom-right) sets all views at once (Cur / A / B / C) and has a per-view override for shell, dashboard, explorer, git, workbench, rest and terminal, so combinations are one click each. The choice is stored per view in `localStorage` (`kedalion.design.<view>`). Without the flag, none of this renders.

This is a design phase: new controls are placeholders (no handler) unless marked "works". Nothing existing was removed, except where noted under Known problems.

Baseline ("Cur"): Transit Dark, Ribbon header nav (no sidebar), Atom icons, flat panels on borders, one toolbar per view, status bar at the bottom.

## The three ideas

| | Idea | Best when you want |
|---|---|---|
| A | Command-first: less chrome, everything reachable from a command bar | maximum room for content, keyboard use |
| B | Dockable canvas: views become panes you arrange side by side | several tools visible at once |
| C | Focus + inspector: one main surface, details of the selection on the right | details and actions without leaving the list |

## Shell (switcher key `shell`)

| | What changes |
|---|---|
| Cur | Ribbon header nav, status bar at the bottom. |
| A | The Ribbon becomes a slim command bar: logo, a wide search field (opens the existing command palette, works), view chips (navigate, works). The status bar is replaced by an activity strip with placeholder facts (git ahead, tsc, timesheet, rate, jobs). |
| B | Ribbon stays. A preset row appears under it: "Layout: Review", chips Review / Debug / Focus, "+ pane". All placeholders. |
| C | Ribbon stays. A right-hand inspector is added to the content area; a header button toggles it (works). Placeholder content: title, status/branch/PR rows, Open / Branch / Log buttons. |

How the change would work for real: A replaces `HeaderNav` and the status bar (shell only). B needs a layout model (saved pane arrangements) and views that accept being a pane. C needs a selection model that each view publishes to the inspector.

## Dashboard (`dashboard`)

| | What changes |
|---|---|
| Cur | Panel grid. |
| A | A briefing list instead of a grid: "Needs you now" and "Recent" (placeholders), then every panel as a full-width collapsible row with a key metric (placeholder "--"). Expanding shows the real panel. |
| B | The existing grid, plus a strip of pane headers (grip, size chip, pane menu) and a "+ pane" tile. Headers are not yet attached to the real panel frames. |
| C | Left: list of panels. Centre: the selected panel (real). Right: inspector with kind, size, position and placeholder buttons. It selects whole panels, not rows inside a panel. |

Real implementation: A needs each panel to expose a one-line summary. B needs drag and resize wired to the grid. C needs panels to publish their selected row (for example Exchange rate history in the inspector).

## Explorer and Git (`explorer`, `git`)

| | What changes |
|---|---|
| Cur | Sidebar with project/branch pickers, tree, editor or diff, toolbars. |
| A | A thin top line with chips (project names, plus the branch in Git) and a "go to…" hint chip. Chips are placeholders; the real pickers stay in the sidebar and its toolbar is not hidden yet. |
| B | A strip of pane headers (grip, pane menu, close) and a "+ pane" button over the real screen. Placeholders. |
| C | A right inspector: file (path, size, modified, git status) or commit (hash, author, date, message), with Open / Copy path / Blame / Revert buttons. Size, modified, author, date and message show "—" for now (not in the current state). |

Real implementation: A means moving the pickers into the top line and hiding the sidebar toolbar. B means real panes. C needs file stat and commit details from the server.

## Workbench, REST, Terminal (`workbench`, `rest`, `terminal`)

| | What changes |
|---|---|
| Cur | Today's toolbar, tabs and panes. |
| A | One full-width surface with a thin top line of chips and the primary action (Send / New session / Run), which works. REST: tab strip hidden, env and history tools kept. Workbench: the full toolbar sits behind a "Tools" toggle. Terminal: tab bar hidden. |
| B | Panes with grip, pane menu (placeholder), close (hides the pane) and "+ pane" (restores it). Both work. |
| C | A right inspector: REST (request details), Terminal (session info, PID shown as "-"), Workbench (item details), real values where they exist, placeholder buttons. |

## Known problems

- Terminal A hides the tab bar, so the profile menu on the new-tab button is unreachable. To fix before choosing A for Terminal.
- C asides in the views are local, not the shared `Inspector` from `@kedalion/ui` (it did not exist when they were built). Unifying them is cheap.
- The shell variants assume the default Ribbon header layout.
- Nothing has been looked at in a running window or screenshotted yet.

## Choosing a combination

Pick per area; the switcher already does this.

- A as the shell with C inside the views: command bar and activity strip, plus an inspector for selections.
- B only on Dashboard and Terminal/REST: places where side-by-side matters; the cost is the highest (needs a layout model).
- C on Git and Explorer: where selection details matter most.

Write down for each row of the tables: keep Cur, A, B or C. That list is the brief for the implementation step (unpicked variants are then deleted).

## Picked (2026-10-31): Cockpit layout

Shell A, Workbench A, REST B; Dashboard, Explorer, Git, Terminal stay Cur. Implemented (2026-11-01) as the Bridge layout (id `cockpit`): the views switch on `useBridge()` (`packages/ui/src/bridge.ts`); they are no longer design variants, and the unpicked variants were removed from the code.
