# Button audit against docs/DESIGN.md

Read-only audit, 2026-10-21. Rows are groups of identical sibling controls.

| Area | OK | Not, should migrate | Not, exception OK |
|---|---|---|---|
| packages/ui + build | 8 | 74 | 23 |
| view-agents top-level | 1 | 34 | 16 |
| view-agents chat/panels/workspace | 2 | 45 | 13 |
| editor, sql-ui, terminal, view-terminal | 3 | 47 | 15 |
| explorer, git, rest, workbench, gallery | 25 | 87 | 21 |
| **Total** | **39** | **287** | **88** |

Verdicts: OK = follows the design. Not, should migrate = deviates and should be `Button`/`IconButton`. Not, exception OK = deviates but is not a generic button (tab, tree row, swatch, toolbar tool...), with the reason.


---

## Button audit: packages/ui/src + packages/build

Counts (one row = one control or one group of identical siblings): **OK 8 / migrate 74 / exception 23** (105 rows).

Key finding: `<Button>`, `<IconButton>` and `buttonClass()` are used nowhere in `packages/ui/src` or `packages/build` (outside `Button.tsx`). Every "migrate" row is a raw `<button className="btn ...">` (right look, wrong construction). The 8 OK rows are documented related controls. `packages/build/view-template` has no buttons.

Notes that apply to many rows:
- "mech" = mechanical swap to Button/IconButton, same variant/size.
- Icon-only rows already use `btn btn-ghost btn-sm btn-icon`, so they map to `<IconButton icon label>`; the swap adds the missing `aria-label` where noted.
- `ui.tsx` is imported by `Button.tsx` (`Icon`), so `ui.tsx` importing `Button` makes a cycle; move `Icon` out of `ui.tsx` first.
- `.active` + `aria-pressed` mix: `.btn-ghost.active` (styles.css:199) duplicates `pressed`; use `pressed` and drop `.active`.
- CSS: see the last section.

## components/AppearanceFields.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 36 | theme chips | raw + chip | OK | documented chip |
| 145 | layout-icon "follow" chip | raw + chip | OK | chip |
| 149 | layout-icon chips | raw + chip | OK | chip |

## components/Breadcrumbs.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 97 | breadcrumb segments | raw + breadcrumbs-seg | OK | documented |
| 229 | "up" dropdown entry | raw + menu-item | EXCEPTION OK | menu item |
| 235-241 | disabled loading/error/empty entries (3) | raw + menu-item | EXCEPTION OK | menu item rows |
| 247 | dir/file entries | raw + menu-item | EXCEPTION OK | menu item |

## components/CommandPalette.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 121 | file result rows | raw + pal-item | EXCEPTION OK | list option row |
| 136 | command result rows | raw + pal-item | EXCEPTION OK | list option row |

## components/ContextMenu.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 94 | menu items | raw + menu-item | EXCEPTION OK | menu item |

## components/Explorer.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 50 | toggle sidebar (rail) | raw btn-ghost btn-sm btn-icon | NOT, SHOULD migrate | IconButton ghost sm; mech (`.explorer-rail .btn` forces 30px width, styles.css:739) |

## components/FileDialog.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 252 | Cancel | raw btn | NOT, SHOULD migrate | Button default md |
| 253 | "OK" (primary) | raw btn-primary | NOT, SHOULD migrate | Button primary md; label should name the result (Open/Save/Choose) |
| 259 | up | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm; icon default size ok |
| 282 | path crumbs | raw + fd-crumb | NOT, SHOULD migrate | duplicate of breadcrumbs-seg; own class (1px outline, own hover); use breadcrumbs-seg |
| 286 | new folder | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 292-300 | places/drives/recents (3) | raw + fd-side-item | EXCEPTION OK | sidebar nav list item (tree-row family); own hover/focus though, could reuse .tree-row |

## components/HeaderNav.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 60 | header tabs | raw + header-tab | EXCEPTION OK | tab (one of five tab styles; backlog) |
| 78 | "more" tab | raw + header-tab | EXCEPTION OK | tab overflow |

## components/IconPicker.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 53 | icon grid items | raw + icon-picker-item | EXCEPTION OK | selectable swatch/grid cell (size 20 tile) |

## components/JsonTree.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 92 | expand/collapse all | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm; mech |
| 116, 119 | prev/next match (2) | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm; mech |
| 191 | node expand caret | raw + json-toggle | EXCEPTION OK | disclosure caret |
| 207 | copy value | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs (inside row; `.json-actions .btn` literal 20px/5px override, styles.css:905); missing aria-label; icon 12 in sm |
| 214 | copy path "$" | raw ghost sm | NOT, SHOULD migrate | Button ghost xs; literal 20px override; text "$" only, title but no icon/aria-label |
| 232 | show more | raw ghost sm | NOT, SHOULD migrate | Button ghost xs (inside tree; `.json-row > .btn` literal 20px) |
| 249 | "more" truncated text | raw + json-more | EXCEPTION OK | inline text link in value (own class, accent text); could be setting-link-like |

## components/KeybindingsEditor.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 97 | find-by-keys toggle | raw btn-sm (+btn-primary when finding) | NOT, SHOULD migrate | Button default sm with `pressed`; uses primary as on-state (misuse); no icon |
| 113 | clear found | raw + keys-x | NOT, SHOULD migrate | IconButton ghost xs (own class, literal sizing) |
| 119 | reset all | raw btn-sm | NOT, SHOULD migrate | Button default sm icon refresh; mech |
| 150 | chord key (click to edit) | raw + keys-chord-key | EXCEPTION OK | key-capture chip showing kbd |
| 153 | remove chord | raw + keys-x | NOT, SHOULD migrate | IconButton ghost xs; own class |
| 167 | add chord | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs (in row); mech |
| 172 | reset chords | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs (in row) |
| 270 | Cancel (capture footer) | raw btn-sm | NOT, SHOULD migrate | Button default sm |
| 271 | Save | raw btn-sm btn-primary | NOT, SHOULD migrate | Button primary sm; label "Save" ok |

## components/LogBookmarkMenu.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 65 | Bookmarks menu trigger | raw btn-sm | NOT, SHOULD migrate | Button default sm icon bookmark; chevron icon hand-placed |
| 78 | bookmark label (rename) | raw + log-bm-label | EXCEPTION OK | inline text link in a list row |
| 83, 87, 92 | go to / copy / save (3) | raw ghost sm | NOT, SHOULD migrate | Button ghost xs (inside row); title only |
| 97 | delete bookmark | raw ghost sm icon + log-icon-btn | NOT, SHOULD migrate | IconButton ghost xs (variant danger on hover optional); redundant log-icon-btn class |

## components/LogHighlightBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 20 | highlight color dot | raw + log-dot | EXCEPTION OK | color swatch (10px) |
| 22 | remove highlight | raw + log-chip-x | NOT, SHOULD migrate | IconButton ghost xs; own class, literal 18px |
| 36 | add highlight | raw ghost sm | NOT, SHOULD migrate | Button ghost sm icon plus; mech |

## components/LogView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 242-244 | Aa / ab / .* toggles (3) | raw ghost sm + log-toggle + `.active` | NOT, SHOULD migrate | Button ghost sm `pressed` (drop `.active`); literal 26px width; text-only, title only (no aria-label) |
| 247-248 | prev/next hit | raw ghost sm icon + log-icon-btn | NOT, SHOULD migrate | IconButton ghost sm; redundant class |
| 251 | level chips | raw + chip log-level | OK | chip filters |
| 258 | follow | raw ghost sm + `.active` | NOT, SHOULD migrate | Button ghost sm icon follow `pressed`; icon size 14 literal |
| 263 | bookmark end | raw ghost sm | NOT, SHOULD migrate | Button ghost sm icon bookmark |

## components/OutputPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 51 | clear | raw ghost sm | NOT, SHOULD migrate | Button ghost sm (icon missing, e.g. trash) |
| 69 | jump to latest | raw btn-sm + output-jump | NOT, SHOULD migrate | Button default sm icon chevron-down; keep position class (`.btn.output-jump` is the allowed add-on) |

## components/Panel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 44 | panel menu | raw ghost sm icon + panel-btn | NOT, SHOULD migrate | IconButton ghost sm; panel-btn duplicates rule |
| 58 | collapse toggle | raw ghost sm + panel-btn | NOT, SHOULD migrate | IconButton ghost sm (`aria-expanded`) |
| 62 | remove panel | raw ghost sm icon + panel-remove | NOT, SHOULD migrate | IconButton ghost sm |

## components/ProjectPicker.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 68 | picker trigger | raw + xp-picker-button | EXCEPTION OK | select-like dropdown trigger with name/path |
| 83-104 | project/add/edit/remove entries (4) | raw + menu-item | EXCEPTION OK | menu items |

## components/Resource.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 39 | Add | raw btn-primary btn-sm | NOT, SHOULD migrate | Button primary sm icon plus |
| 52 | open resource (row) | raw + resource-open | EXCEPTION OK | list row open target |
| 59, 62 | edit / delete (2) | raw ghost sm icon + resource-btn | NOT, SHOULD migrate | IconButton ghost xs (in row); delete could be danger; redundant class |
| 161, 178 | Browse / Clear | raw btn-sm | NOT, SHOULD migrate | Button default sm, no icon (folder/close) |
| 192 | Cancel | raw btn | NOT, SHOULD migrate | Button default md |
| 193 | Save (submit) | raw btn-primary | NOT, SHOULD migrate | Button primary md type=submit |

## components/SettingFields.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 39 | inline links | raw + setting-link | OK | documented |
| 180 | option chips | raw + chip | OK | chip |
| 212 | reset (arrow glyph) | raw + setting-reset | NOT, SHOULD migrate | IconButton ghost xs icon rotate-ccw; text glyph, literal 22px/radius, own hover-reveal (reveal can stay as add-on class) |

## components/Sidebar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 87 | nav items | raw + side-item | EXCEPTION OK | navigation item |
| 112 | collapse toggle | raw ghost sm icon + side-toggle | NOT, SHOULD migrate | IconButton ghost sm `pressed`; `.sidebar.collapsed .side-footer .btn-icon` literal 36px (styles.css:292) |

## components/StatusBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 29 | status actions | raw + status-item status-action | EXCEPTION OK | status bar item |

## components/TabWorkspace.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 183, 186 | back / forward (2) | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm; missing aria-label; icon size 15 (retired) |
| 237 | tab close | raw + tab-close | EXCEPTION OK | part of tab-chip |
| 251 | new tab | raw ghost sm icon + tab-new | NOT, SHOULD migrate | IconButton ghost sm (`.tabbar .btn-icon` forces 26px, styles.css:535) |
| 265 | new-tab menu | raw ghost sm icon + tab-new-menu | NOT, SHOULD migrate | IconButton ghost sm |
| 295 | pane actions | raw ghost sm icon + `.active` | NOT, SHOULD migrate | IconButton ghost sm with `pressed` (drop `.active`) |
| 308 | split | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 318 | more | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |

## components/Toast.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 99 | action | raw ghost sm | NOT, SHOULD migrate | Button ghost sm |
| 101 | close | raw ghost sm icon + toast-close | NOT, SHOULD migrate | IconButton ghost sm |

## components/TreeView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 593, 736 | retry (2) | raw ghost sm | NOT, SHOULD migrate | Button ghost xs icon refresh (CSS forces height 22px via `.tree-error .btn`, styles.css:729) |

## components/ui.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 55 | ErrorBanner details | raw ghost sm | NOT, SHOULD migrate | Button ghost sm (xs if compact) |
| 60 | ErrorBanner retry | raw btn-sm | NOT, SHOULD migrate | Button default sm icon refresh |
| 76 | CopyButton | raw ghost sm | NOT, SHOULD migrate | Button ghost sm; implements its own copy/check icon; circular import with Button.tsx |
| 186 | modal maximize | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 195 | modal close | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 241 | confirm Cancel | raw btn | NOT, SHOULD migrate | Button default md |
| 242 | confirm OK | raw btn-primary/danger | NOT, SHOULD migrate | Button primary/danger md; default label "OK" should name result |
| 261 | choice Cancel | raw btn | NOT, SHOULD migrate | Button default md |
| 263 | choice buttons | raw btn (primary first/danger) | NOT, SHOULD migrate | Button md; empty-string variant for non-first |
| 300 | prompt Cancel | raw btn | NOT, SHOULD migrate | Button default md |
| 301 | prompt OK (submit) | raw btn-primary | NOT, SHOULD migrate | Button primary md; label "OK" |

## build/template/web/src/App.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 184 | settings | raw ghost sm icon + `.active` | NOT, SHOULD migrate | IconButton ghost sm `pressed` |
| 191 | theme toggle | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 195 | pop out | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 200 | palette | raw ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |

## build/template/web/src/screens/Home.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 12 | retry | raw btn-sm + Icon | NOT, SHOULD migrate | Button default sm icon refresh |

## build/template/web/src/screens/SettingsModal.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 300 | modified-only filter | raw + settings-nav-filter (inline svg) | NOT, SHOULD migrate | IconButton ghost sm `pressed` icon filter; own class, inline svg, own pressed style |
| 316 | open settings file | raw btn-sm | NOT, SHOULD migrate | Button default sm icon |
| 317 | close | raw ghost sm icon with "✕" glyph | NOT, SHOULD migrate | IconButton icon close; text glyph |
| 324, 326, 382 | links | raw + setting-link | OK | documented |
| 337 | nav tree items | raw + settings-nav-item | EXCEPTION OK | nav/tree row |
| 394 | clear search | raw btn-sm | NOT, SHOULD migrate | Button default sm (icon) |
| 472 | quit | raw btn-sm btn-danger | NOT, SHOULD migrate | Button danger sm icon square |

## ui/src/assets/icons/original/index.html
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 17 | theme toggle | raw `<button>` in static icon sheet | EXCEPTION OK | standalone asset page, no app styles |

## build/view-template
No `<button>`, `btn` or `role="button"` found. No `<a>`/`<label>` styled as buttons anywhere in scope.

## CSS classes that style buttons (packages/ui/src/styles.css)
| line | class | verdict | note |
|---|---|---|---|
| 186-209 | `.btn`, `-sm`, `-xs`, `-icon`, `-ghost`, `-primary`, `-danger`, `[aria-pressed]` | OK | the standard |
| 199 | `.btn-ghost.active` | migrate | duplicates `aria-pressed`; remove after callers use `pressed` |
| 560, 621, 927 | `.panel-btn`, `.resource-btn`, `.log-icon-btn` | migrate | three copies of one rule (width 28, color text-3 for first two); drop with IconButton |
| 926 | `.log-toggle` | migrate | literal 26px width, h 24 |
| 905-906 | `.json-actions .btn`, `.json-row > .btn` | migrate | literal 20px/5px; replace with `xs` |
| 729 | `.tree-error .btn` | migrate | height override; use `xs` |
| 535 | `.tabbar .btn-icon` | check | forces 26px (control-h-xs) in tab bar; not a standard size |
| 739, 292 | `.explorer-rail .btn`, `.sidebar.collapsed .side-footer .btn-icon` | check | 30/36px overrides |
| 605 | `.output-jump` | OK | position add-on only |
| 1133 | `.setting-reset` | migrate | literal 22px, glyph button |
| 1060 | `.keys-x`, 937 `.log-chip-x` | migrate | own icon-button copies (18px literal) |
| 1079 | `.settings-nav-filter` | migrate | own toggle look |
| 404, 412 | `.fd-crumb`, `.fd-side-item` | migrate / exception | fd-crumb duplicates breadcrumbs-seg; fd-side-item is a nav row |
| 890, 902, 935, 980, 1057, 580, 613, 1390 | `json-toggle`, `json-more`, `log-dot`, `log-bm-label`, `keys-chord-key`, `status-action`, `resource-open`, `xp-picker-button` | exception | see rows above |

---

## Audit: button-like controls, packages/view-agents/src/web/*.tsx (top level)

Summary (rows, identical siblings grouped): OK 1 / NOT-SHOULD-MIGRATE 34 / NOT-EXCEPTION-OK 16.
No file in scope uses `<Button>`, `<IconButton>` or `buttonClass(...)`. Files with no button-like control: AgentsScreen, AlertsPanel, Badge, StatusDot, StatusIcon, StatusStrip, TrajectoryTab (only the step row), UsageTab. `<label>` hits (AddProject:77, ManageAccounts:43,120, RecoveryBanner:41) are form/checkbox labels, not buttons. `<summary>` StoppedCard:147 is a disclosure caption, not a button.
Common deviations: raw `<button>` with no class (browser-default look, no hover/focus/disabled design); `agents-*-btn` own classes; literal px/radius; `var(--x, #fff)` fallbacks; undefined tokens (`--ink`, `--bg-hover`, `--on-accent`); raw `btn btn-*` classes instead of the component.

## AccountPicker.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 39, 50 | account choice rows in picker modal | raw + `.agents-pick` | NOT, EXCEPTION OK | menu/list item with current mark; list row (`.tree-row` family), not an action button. Own hover/height; ideally `.tree-row` + `useRovingList` |

## AccountsSettings.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 27 | segmented option (value choices) | raw + `chip`/`chip-on`, aria-pressed, title | OK | documented chip |
| 52 | icon picker trigger (opens listbox) | raw + `.agents-icon-btn` (styles.css:256) | NOT, SHOULD migrate | `Button` default, sm, with icon; own class: padding 2px, radius 4px literal, no hover bg, no focus-visible, no disabled |
| 62 | icon options in listbox | raw + `.agents-icon-opt` role=option | NOT, EXCEPTION OK | swatch/option cell in a listbox (28px, radius 4px literal; should use token radius) |
| 172 | Add account | raw + `.agents-statusline-btn` (grid placement only, styles.css:246) | NOT, SHOULD migrate | no button styling at all (browser default); `Button` default sm, icon `plus` |
| 174 | Remove account | same | NOT, SHOULD migrate | `Button` danger sm, icon `trash`; unstyled; destructive but looks like Add |

## AddProject.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 49 | Cancel (dialog footer) | raw, no class | NOT, SHOULD migrate | `Button` default md; unstyled |
| 50 | Add (dialog footer, confirm) | raw, no class | NOT, SHOULD migrate | `Button` primary md; unstyled; label should name result |
| 65 | recent project rows | raw + `.agents-add-item` (styles.css:161,347) | NOT, EXCEPTION OK | two-line list row (name + path), not an action button; duplicate rule blocks, `var(--hover, rgba())` fallback and `--ink-muted` undefined token |
| 75 | Browse... | raw, no class | NOT, SHOULD migrate | `Button` default sm, icon `folder`; unstyled |

## BatchBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 24 | batch actions (map) | raw + `btn btn-sm` (+ `danger`) | NOT, SHOULD migrate | `Button` sm; danger uses class `danger`, not `btn-danger`, so danger never styled; no icons |
| 26 | Clear selection | raw + `btn btn-sm` | NOT, SHOULD migrate | `Button` ghost sm (or default), icon `close` |

## EmptyState.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 15 | New session (empty state CTA) | raw + `.agents-empty-btn` (main.css:38) | NOT, SHOULD migrate | `Button` primary md, icon `plus`; h28 r6 literal px, `var(--on-accent, #fff)` fallback, no hover/disabled, outline-offset 2px |

## ExitBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 17 | Restart | raw + `.agents-bar-btn` (main.css:24) | NOT, SHOULD migrate | `Button` default xs, icon `rotate-ccw`; h22, radius 4px literal, `--ink`/`--bg-hover`/`--border-soft` mix, no focus-visible |
| 18 | Close | raw + `.agents-bar-btn` | NOT, SHOULD migrate | `Button` ghost/default xs, icon `close` |

## ExternalPane.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 22 | Take over / Close (hanging) | raw, no class | NOT, SHOULD migrate | `Button` default xs (primary if main action), icon; unstyled |

## GroupSummary.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 60 | session rows in group summary | raw + `.agents-summary-row` (styles.css:236) | NOT, EXCEPTION OK | selectable list row; but should be `.tree-row`: literal 3px 4px padding, radius 4px, undefined `--ink`/`--bg-hover` |

## ManageAccounts.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 117 | Create (Modal footer) | raw + `btn btn-primary` | NOT, SHOULD migrate | `Button` primary md; right classes, raw element (minor) |
| 139 | Back | raw + `btn` | NOT, SHOULD migrate | `Button` default md, icon `arrow-left` optional |
| 140 | Apply | raw + `btn btn-primary` | NOT, SHOULD migrate | `Button` primary md, icon `check` |
| 168 | Edit (row) | raw + `btn btn-sm` | NOT, SHOULD migrate | `Button` default xs (row action, not sm), icon `edit` |
| 169 | Delete (row) | raw + `btn btn-sm btn-danger` | NOT, SHOULD migrate | `Button` danger xs (row action), icon `trash` |

## MoveToFolder.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 25 | folder choice rows | raw + `.agents-pick` | NOT, EXCEPTION OK | list/menu item with current mark (same as AccountPicker) |

## NewSession.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 70-71 | Cancel / Confirm (capability prompt) | raw, no class | NOT, SHOULD migrate | `Button` default md + primary md (or danger); unstyled |
| 75 | Cancel | raw, no class | NOT, SHOULD migrate | `Button` default md; unstyled |
| 76 | Start (shown only when `error`) | raw, no class | NOT, SHOULD migrate | `Button` primary md, icon `play`; unstyled; oddly only rendered on error |

## NotesTab.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 84 | Send notes | raw + `className="primary"` | NOT, SHOULD migrate | `Button` primary sm, icon `send`; class `primary` is not `btn-primary` (no `btn` at all), `onMouseDown preventDefault` can stay |

## RecoveryBanner.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 25, 30 | Resume / Resume all | raw + `.agents-bar-btn.is-primary` | NOT, SHOULD migrate | `Button` primary xs, icon `play`; `var(--on-accent, #fff)` fallback |
| 26, 31 | Back / Pick | raw + `.agents-bar-btn` | NOT, SHOULD migrate | `Button` default xs |

## ResumeBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 11 | Resume | raw + `.agents-bar-btn.is-primary` | NOT, SHOULD migrate | `Button` primary xs, icon `play` |
| 12 | Dismiss | raw + `.agents-bar-btn` | NOT, SHOULD migrate | `Button` ghost xs, icon `close` |

## SessionHead.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 40 | HeadButton: stop/restart/copy/trajectory/panel toggle (icon only) | raw + `.agents-head-btn` (main.css:16) | NOT, SHOULD migrate | `IconButton` ghost xs/sm; has title + aria-label (good) but own 24px, radius 4px literal, `--ink*`/`--bg-hover` tokens, inset focus ring; toggles lack `pressed`; stop should be danger |

## Sidebar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 806 | status filter pills (glyph + count, aria-pressed) | raw + `.agents-pill` (styles.css:59) | NOT, EXCEPTION OK | dense status-count toggle strip; closest documented control is `chip`/`chip-on`; own radius xs, `--fs-3xs`; acceptable but could adopt chip |
| 913 | session row | raw + `.agents-session` | NOT, EXCEPTION OK | tree row with drag/drop, check, snippet; selected via right bar (backlog notes it) |
| 987 | twisty (expand/collapse caret) | raw + `.agents-twisty` | NOT, EXCEPTION OK | disclosure caret inside a tree row; has title+aria-label+aria-expanded |
| 989 | folder/group/project node label | raw + `.agents-node` | NOT, EXCEPTION OK | tree row label (select/toggle) |
| 1028 | quick new session (+) in project row | raw + `.agents-new` (styles.css:19) | NOT, SHOULD migrate | `IconButton` ghost xs, icon `plus`; glyph via font-size, no size/hover bg/focus-visible; title+aria-label present |
| 1029 | remove project (x) in project row | raw + `.agents-remove` (styles.css:112) | NOT, SHOULD migrate | `IconButton` danger/ghost xs, icon `close` (or `trash`); no size, no focus-visible |
| 1134 | Add account (empty sidebar) | raw + `btn btn-primary btn-sm agents-sidebar-empty-btn` | NOT, SHOULD migrate | `Button` primary sm (md in empty state), icon `plus`; right classes, raw element; no title |
| 1142 | Add project (empty sidebar) | raw + `btn btn-primary btn-sm agents-sidebar-empty-btn` | NOT, SHOULD migrate | same; `Button` primary, icon `folder-plus`/`plus` |
| 1173 | tag filter rows (# tag (n)) | raw + `.agents-tag-row .agents-node` | NOT, EXCEPTION OK | tree-row style filter row, aria-pressed |
| 1245 | Add section (+ label) | raw + `.agents-section-add` (sidebar.css:24) | NOT, SHOULD migrate | `Button` ghost sm, icon `plus`; own class: dashed border, h30 literal, outline none (inset ring) |

## SidebarSection.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 13 | SectionButton (icon, hover-reveal) | raw + `.agents-section-btn` (sidebar.css:18) | NOT, SHOULD migrate | `IconButton` ghost xs (pressed supported); own 22px size, `--radius-sm`, opacity-reveal and inset focus ring; reveal can stay as extra class |
| 93 | section toggle (head with label + note) | raw + `.agents-section-toggle` | NOT, EXCEPTION OK | collapsible section header (disclosure), full-width row, not an action |

## SkillsPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 24 | Close (icon) | raw + `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | classes correct (ghost sm icon, title+aria-label) but hand-built; use `IconButton icon="close" label` |
| 31 | tabs (role=tab) | raw + `.agents-skills-tab` (styles.css:377) | NOT, SHOULD migrate | section tabs must be `.req-tab` (DESIGN "Section tabs", lists `agents-skills-tab` as Not); bordered pill, literal-free but own style |

## StatuslineCard.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 90 | Install / Uninstall statusline | raw + `.agents-statusline-btn` (grid only) | NOT, SHOULD migrate | `Button` default sm (danger when uninstall), icon `download`; unstyled |

## StoppedCard.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 90 | show more / less files | raw + `.chat-more` (styles.css:227) | NOT, EXCEPTION OK | inline text link in a list (documented Link control); should be `setting-link`; literal 2px padding |

## StoppedPane.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 33 | compact / show full | raw + `.chat-more` | NOT, EXCEPTION OK | inline text link (as above); a ghost xs toggle would also fit |

## TrajectoryTab.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 79 | trajectory step rows | raw + `.agents-traj-step` (styles.css:277) | NOT, EXCEPTION OK | selectable list row (master list of a detail pane); should be `.tree-row` + roving; own bg `--bg-hover` undefined |

## TrashPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 62 | trashed session rows (click restores) | raw + `.agents-pick .agents-trash-row` | NOT, EXCEPTION OK | list row with title+age; restore-on-click has no explicit Restore button (consider ghost xs Restore) |

## UsageView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 240 | clickable usage summary card | raw + `.clickable` on card class | NOT, EXCEPTION OK | whole-card click target (custom card), has title + aria-label |

## Agents button CSS classes (packages/view-agents/src/**/*.css)
| class | file:line | role | deviations |
|---|---|---|---|
| `.agents-bar-btn`, `.is-primary` | web/main.css:24-27 | bar buttons (Exit/Recovery/Resume) | h22 literal, radius 4px, `--ink`/`--bg-hover`/`--border-soft`, `var(--on-accent, #fff)`, disabled `cursor: default`, no focus-visible |
| `.agents-empty-btn` | web/main.css:38 | empty CTA | h28, padding 14px, radius 6px literals, `--on-accent, #fff` fallback, no hover/disabled |
| `.agents-head-btn` | web/main.css:16-18 | session head icon button | 24px, radius 4px literal, `--ink-muted`/`--ink`/`--bg-hover`, `--agents-fast` own motion token, inset focus |
| `.agents-icon-btn` | styles.css:256 | icon picker trigger | padding 2px, radius 4px literal, no focus-visible/disabled |
| `.agents-icon-opt` | styles.css:259 | icon option swatch | 28px, radius 4px literal |
| `.agents-statusline-btn` | styles.css:246 | grid placement only | no visual style at all |
| `.agents-section-btn` | web/sidebar.css:18 | section head icon | 22px literal, `--radius-sm`, opacity reveal, own motion token, inset focus |
| `.agents-section-add` | web/sidebar.css:24 | add section row | dashed border, h30, `--radius-md`, outline none |
| `.agents-section-toggle` | web/sidebar.css:10 | section head toggle | disclosure row (exception); inset focus |
| `.agents-new`, `.agents-remove` | styles.css:19,112 | project row icon actions | no size/border/radius; glyph-sized; no focus-visible |
| `.agents-pill` | styles.css:59 | status filter pill | own radius/fs-3xs; outline none; inset focus |
| `.agents-skills-tab` | styles.css:377 | skills tabs | duplicate of `.req-tab` role |
| `.agents-pick` | styles.css:317 | choice rows | row rules; `outline: none`, own hover |
| `.agents-add-item` | styles.css:161,347 | project rows | duplicate rule blocks; `var(--hover, rgba())` fallback; undefined `--ink-muted` |
| `.agents-summary-row` | styles.css:236 | summary rows | literal 3px 4px, radius 4px; undefined `--ink`, `--bg-hover` |
| `.agents-traj-step` | styles.css:277 | step rows | undefined `--bg-hover`; inset focus |
| `.chat-more` | styles.css:227 | text link buttons | link look, not `setting-link` |
| `.agents-output-btn` | web/panels/output/style.css:13 | output panel (out of scope subfolder) | h24, `#8884`/`#8882`/`#3b82f6` hex fallbacks |
| `.agents-scratchpad-btn` | web/panels/scratchpad/style.css:12 | scratchpad (subfolder) | only `cursor: pointer` |
| `.agents-node-actions button` | not found as a rule in view-agents css; markup at Sidebar.tsx:1027 | row actions | covered by `.agents-new`/`.agents-remove` |

---

## Agents sub-tree button audit (chat, panels/**, workspace)

Summary (control groups, identical siblings in one row counted once): **OK 2 / migrate 45 / exception 13** (OK = 2 rows, 4 `Button`s in Run)

Only `panels/run/index.tsx` uses `Button`. No file in scope uses `IconButton` or `buttonClass`. No `role="button"`. Only `<a>` is the Run URL link. Files with no button-like control: chat/Transcript.tsx, panels/agent, diff (index, FileDiff), notes, skills, trajectory, workspace/ComingSoon, MissingPanel, host.tsx.

## chat/CompactTranscript.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 39 | "Load earlier" | raw + `.chat-more` | NOT, SHOULD migrate | `Button` ghost xs; own css (no border, literal 2px pad, no hover/disabled/focus-visible); `title` duplicates label |

## panels/changes/index.tsx (no button css in changes/style.css: unstyled browser buttons)
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 109-122 | New branch, Pull, Push, Stash, Pop (5 siblings) | raw, no class | NOT, SHOULD migrate | `Button` sm default in toolbar, `ToolbarSep` between branch/sync/stash groups; add icons (plus, download, upload); no styling, no variant/size/icon |
| 125 | Refresh (glyph ↻) | raw, no class | NOT, SHOULD migrate | `IconButton` icon=refresh ghost sm; text glyph instead of Icon |
| 139 | Commit | raw | NOT, SHOULD migrate | `Button` primary sm icon=check (the one main action) |
| 142 | Commit and push | raw | NOT, SHOULD migrate | `Button` default sm (icon upload) |
| 145 | Amend checkbox label | `<label>` + checkbox | NOT, EXCEPTION OK | checkbox, not a button |
| 149 | Undo | raw | NOT, SHOULD migrate | `Button` default sm icon=rotate-ccw |
| 169 | Unstage all | raw | NOT, SHOULD migrate | `Button` default xs (group head action) |
| 174 | Stage all | raw | NOT, SHOULD migrate | `Button` default xs icon=plus |
| 177 | Discard all | raw | NOT, SHOULD migrate | `Button` danger xs (destructive) |
| 186 | File row open-diff (code + path) | raw `.agents-chg-open` | NOT, EXCEPTION OK | custom list row (tree-row-like); should use row hover/selected classes rather than btn |
| 196 | Unstage per file (glyph −) | raw | NOT, SHOULD migrate | `IconButton` ghost xs icon=minus; glyph text, no styling |
| 201 | Stage per file (glyph +) | raw | NOT, SHOULD migrate | `IconButton` ghost xs icon=plus |
| 204 | Discard per file (glyph ×) | raw | NOT, SHOULD migrate | `IconButton` danger xs icon=trash/close |

## panels/code/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 96 | Save | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` primary sm icon=check; empty-btn has no disabled style (disabled={!dirty} looks active), h28 r6 literal |
| 99 | Open external | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` default/ghost sm; two primary-looking buttons in one toolbar |
| 106 | Reload (stale banner) | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` primary xs icon=rotate-ccw |
| 109 | Dismiss (stale banner) | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` default xs |

## panels/output/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 125 | Copy snippet | raw `.agents-output-btn` | NOT, SHOULD migrate | `Button` default xs icon=copy; css hex fallbacks `#8884/#8882/#8883/#3b82f6`, literal h24/r4, font .75em, no disabled/focus |
| 155 | Wrap (toggle) | raw `.agents-output-btn` + aria-pressed | NOT, SHOULD migrate | `Button` ghost xs `pressed` |
| 156 | Copy | raw `.agents-output-btn` | NOT, SHOULD migrate | `Button` ghost xs icon=copy (output action, last in group) |
| 157 | Clear | raw `.agents-output-btn` | NOT, SHOULD migrate | `Button` ghost xs |

## panels/review/ask.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 83 | Quick actions (ACTIONS.map) | raw, no class | NOT, SHOULD migrate | `Button` default xs |
| 87 | Custom... | raw | NOT, SHOULD migrate | `Button` default xs |
| 100 | Send (submit) | raw | NOT, SHOULD migrate | `Button` primary xs, `type=submit` |

## panels/review/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 89 | File expand caret (▾/▸ glyph) | raw `.agents-review-toggle` | NOT, EXCEPTION OK | disclosure caret; but should use `Icon chevron` + focus-visible (css: no focus, no hover) |
| 93 | Viewed checkbox label | `<label>` + checkbox | NOT, EXCEPTION OK | checkbox, not a button |
| 111 | Diff line (click adds comment) | `<div onClick>` | NOT, EXCEPTION OK | diff line row; no keyboard/role, a11y gap, not button standard |
| 119 | Remove comment (×) | raw in `.agents-review-comment button` | NOT, SHOULD migrate | `IconButton` ghost xs icon=close; css `background:none;border:0`, no hover/focus/disabled |
| 135 | Add (submit) | raw | NOT, SHOULD migrate | `Button` primary xs |
| 136 | Cancel | raw | NOT, SHOULD migrate | `Button` default xs (Cancel before primary: order currently Add then Cancel, swap) |
| 233 | Send (n) | raw | NOT, SHOULD migrate | `Button` primary sm; footer |

## panels/run/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 69 | Stop | `Button` xs danger icon=square | OK | matches doc |
| 70,73,75 | Restart / Start / Logs | `Button` xs default+rotate-ccw / primary+play / ghost+log pressed | OK | matches doc |
| 85 | Run URL link | `<a class="agents-run-url">` | NOT, EXCEPTION OK | text link in a row (setting-link style), not an action button |

## panels/scratchpad/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 75 | Notes label | `<label htmlFor>` | NOT, EXCEPTION OK | form label for a textarea, not a button |
| 95,98,101 | Move up, Move down, Delete (glyph ↑ ↓ ×) | raw `.agents-scratchpad-btn` (css `cursor:pointer` only) | NOT, SHOULD migrate | `IconButton` ghost xs (arrow-up, arrow-down, trash/close); text glyphs, no styling/hover/focus; disabled uses browser default |
| 115 | Add (submit) | raw `.agents-scratchpad-btn` | NOT, SHOULD migrate | `Button` default sm `type=submit` |

## panels/task/index.tsx (all raw, no class, `title` duplicating label)
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 168 | Review-when-done checkbox label | `<label>` | NOT, EXCEPTION OK | checkbox |
| 173 | Start | raw | NOT, SHOULD migrate | `Button` primary sm icon=play |
| 193 | Task list item (click selects) | `<li onClick>` | NOT, EXCEPTION OK | custom selectable row (use tree-row + roving list); no keyboard access |
| 213 | Open session | raw | NOT, SHOULD migrate | `Button` default sm icon |
| 217 | Cancel plan | raw | NOT, SHOULD migrate | `Button` danger sm icon=square |
| 223 | Revise (toggle) | raw | NOT, SHOULD migrate | `Button` default sm, `pressed={revising}` |
| 226 | Approve | raw | NOT, SHOULD migrate | `Button` primary sm icon=check |
| 232 | Remove | raw | NOT, SHOULD migrate | `Button` danger sm (delete) |
| 245 | Send revision | raw | NOT, SHOULD migrate | `Button` primary sm |
| 239 | Revision label | `<label htmlFor>` | NOT, EXCEPTION OK | form label |

## panels/usage/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 56 | Limit input label | `<label>` | NOT, EXCEPTION OK | form label wrapping input |
| 153 | Remove budget | raw | NOT, SHOULD migrate | `Button` ghost/danger xs |
| 162 | Combined/Split toggle | raw + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed`; label flips instead of fixed label + pressed |
| 163 | Refresh | raw | NOT, SHOULD migrate | `IconButton` ghost sm icon=refresh |
| 220 | Save | raw | NOT, SHOULD migrate | `Button` primary sm icon=check |

## panels/workflows/index.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 66 | Run header (name, meta, status; accordion) | raw `.agents-wf-head` aria-expanded | NOT, EXCEPTION OK | accordion row header, not an action button |

## workspace/EmptyCard.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 12 | New session | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` primary md icon=plus (empty-state action); `#fff` fallback in main.css:38, h28 r6 literal, no disabled; `title` duplicates label |

## workspace/PanelBoundary.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 30 | Reload | raw `.agents-empty-btn` | NOT, SHOULD migrate | `Button` primary md icon=rotate-ccw |

## workspace/ProjectWorkspace.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 184 | Add section (full-width dashed) | raw `.agents-section-add` | NOT, SHOULD migrate | `Button` ghost sm icon=plus with menu (`aria-haspopup`); own dashed border, h30 literal, inset focus, no disabled |
| 199 | Section fold toggle (chevron + label) | raw `.agents-section-toggle` aria-expanded | NOT, EXCEPTION OK | section-head disclosure |
| 199 | Hide section (x) via `SectionButton` (web/SidebarSection.tsx:10) | raw `.agents-section-btn` | NOT, SHOULD migrate | `IconButton` ghost xs icon=close; 22px literal r-sm, `outline:none` + inset focus, opacity reveal, no disabled; fix in `SectionButton` (also used in SidebarSection.tsx:101) |

## Button CSS classes in scope css (deviations)
| file:line | class | deviations |
|---|---|---|
| web/main.css:38 | `.agents-empty-btn` | primary look duplicate; `var(--on-accent, #fff)` hex fallback and undefined token (should be `--ink-on-accent`); literal h28/r6/px; margin-top 8px; no hover, no disabled; focus 2px offset 2 (not 1) |
| panels/output/style.css:13-15 | `.agents-output-btn` | hex `#8884 #8882 #8883 #3b82f6` fallbacks; literal h24/r4/font .75em; no disabled/focus-visible |
| panels/review/style.css:6,17 | `.agents-review-toggle`, `.agents-review-comment button` | bare `background:none;border:0`; no hover, focus-visible, disabled |
| panels/scratchpad/style.css:12 | `.agents-scratchpad-btn` | `cursor:pointer` only: no look, hover, focus, disabled |
| web/sidebar.css:18-22 | `.agents-section-btn` | literal 22px; `outline:none`; no disabled; uses `--radius-sm` (should be md for xs) |
| web/sidebar.css:24-26 | `.agents-section-add` | literal h30; dashed border own look; no disabled |
| web/sidebar.css:48 | `.agents-node-actions button` | literal 20px; no focus/disabled (outside scope tsx) |
| web/main.css:16-18, 24-27 | `.agents-head-btn`, `.agents-bar-btn` | literal 24/22px, r4, undefined tokens `--ink --ink-muted --bg-hover`, `#fff` fallback, `.agents-bar-btn` is a primary copy (outside scope tsx) |
| styles.css:89,92,103,227,256 | `.agents-toggle`, `.agents-mode button`, `.agents-panel-tabs button`, `.chat-more`, `.agents-icon-btn` | literal r4/px, undefined tokens; `.chat-more` is used in scope (CompactTranscript:39) |
| web/chrome.css:24-27 | `.agents-panel-tabs button` | tab strip (should be `req-tab`/tab-chip); literal 12px font |
| panels/changes/style.css | (none) | changes panel buttons have no css at all: rely on global button defaults |

---

## Button audit: editor, sql-ui, terminal, view-terminal

Counts (rows; sibling groups = 1 row): OK 3 / migrate 47 / exception 15 (total 65).

Notes
- No file in scope imports `Button`, `IconButton` or `buttonClass`. Every control is a raw `<button>` (or DOM-built / div). Most already carry correct `btn btn-*` classes, so "migrate" is mostly mechanical (raw + btn classes -> component).
- Raw `<button className="btn ...">` counts as migrate (standard: use the component, not bare button).
- Toggle groups in RequestEditor use `btn-primary` for the selected state; standard says `pressed` (accent-soft), primary only for the one main action.
- Not buttons (omitted): `<label className="field|req-check|pdf-layer|setting-check">` (form labels, checkbox rows) in RequestEditor, PdfView, SvgView, cards.tsx, TerminalSchemes. No `<a>` and no `<label>` styled as a button in scope.
- view-terminal/src: TerminalScreen.tsx, view.tsx have no buttons; terminal/src/terminal.css and editor/src/rich/toolbar.css have no button rules beyond below (toolbar.css `.md-tb .btn:focus-visible` overrides the shared focus ring with an inset 1px; `.md-tb-items .btn`).
- Related CSS (packages/ui/src/styles.css, not in scope but styles these): `.md-toc-rail/.md-toc-item` (859-872), `.md-code-copy` (836), `.sqlite-table` (1266-1271), `.sqlsteps-*` (1287+). `editor/src/rich/view.css:1-4` `.md-zoom button` (22px, 4px radius literal, `var(--hover, rgba(...))` fallback = rules 1, 2, 4 violations).

## editor/src/DiffView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 130 | split/inline mode switch (`.diff-view-bar`) | raw button, `active` class | NOT, SHOULD migrate | seg control (proposed) = `seg` + `Button` ghost sm `pressed`; own `.diff-view-bar` styling |

## editor/src/EnvView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 22 | Reveal/Hide all | raw `btn btn-ghost btn-sm` | NOT, SHOULD migrate | `Button` ghost sm; add icon (eye) per "actions get an icon" |
| 34 | per-row reveal/hide | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm (label via `label`) |

## editor/src/FilePreview.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 75 | Source/Rendered toggle | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed`; no icon |

## editor/src/MarkdownToc.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 112 | TOC rail (tick marks) | raw button `md-toc-rail` | NOT, EXCEPTION OK | custom minimap widget (ticks + indicator), not a labelled action |
| 124 | TOC entry per heading | raw button `md-toc-item` | NOT, EXCEPTION OK | list/tree row (indent by level, active = accent); should use tree-row styles, not Button |

## editor/src/PdfView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 157, 172 | prev/next page | raw `btn btn-ghost btn-sm` (no `btn-icon`) + `.pdf-prev` span | NOT, SHOULD migrate | `IconButton` sm chevron; missing `btn-icon`, own rotation span |
| 175 | zoom out "−" | raw `btn btn-ghost btn-sm`, text glyph | NOT, SHOULD migrate | `IconButton` sm (minus icon); inconsistent with zoom-in |
| 177 | zoom in | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm |
| 180 | Fit | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed` |
| 181 | Layers toggle | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed`, icon layers |

## editor/src/RequestEditor.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 72 | Cancel request (while sending) | raw `btn` (md default) | NOT, SHOULD migrate | cancel a run = `danger`, icon `square`, size match Send; not default |
| 74 | Send | raw `btn btn-primary req-send` + Icon | NOT, SHOULD migrate | `Button` primary md icon send; view class `req-send` ok to add via className |
| 82 | request tabs (Params/Headers/Body/...) | raw `req-tab`, role=tab | OK | documented section tab |
| 185 | Bulk edit toggle | raw `btn btn-sm` primary/ghost swap | NOT, SHOULD migrate | `Button` ghost sm `pressed`; selected state must be `pressed`, not primary |
| 236 | remove header row | raw `btn btn-ghost btn-sm btn-icon` + Icon close | NOT, SHOULD migrate | `IconButton` sm (or xs inside rows) |
| 266 | remove param/field row | same as 236 | NOT, SHOULD migrate | `IconButton` sm/xs |
| 299 | Auth kind None/Basic/Bearer | raw `btn btn-sm`, primary vs ghost | NOT, SHOULD migrate | seg group of `Button` ghost sm `pressed`; primary misused for selected |
| 350 | Body lang json/xml/text/form/multipart | raw `btn btn-sm`, primary vs ghost | NOT, SHOULD migrate | same as 299 |
| 364 | Format | raw `btn btn-ghost btn-sm` | NOT, SHOULD migrate | `Button` ghost sm; add icon |

## editor/src/ResponseView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 36 | Save response | raw `btn btn-sm` + Icon download | NOT, SHOULD migrate | `Button` default sm icon download; icon size not from Button (14 default OK) |
| 42 | response tabs | raw `req-tab`, role=tab | OK | documented section tab |
| 63 | Tree/Raw toggle | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed`; label flips with state (confusing with pressed) |

## editor/src/rich/HeadingPicker.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 82 | heading palette item | raw button `pal-item` | NOT, EXCEPTION OK | command-palette list row (label + hint, active highlight), not an action button |

## editor/src/rich/Toolbar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 177 | formatting items (bold, italic, lists, ...) | raw `btn btn-ghost btn-sm btn-icon` + `active` class, glyph or Icon | NOT, EXCEPTION OK | rich-text toolbar: mixed text glyph/icon content, `data-tb-item` measured for overflow, `onMouseDown preventDefault` to keep editor selection, inset focus ring in toolbar.css; already uses btn classes. Could still use `IconButton` with `pressed` for icon items |
| 193 | "More" overflow | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm icon more (opens ContextMenu, ok per standard) |

## editor/src/rich/ZoomControl.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 24-27 | floating − / % / + / Fit-Center | raw unclassed buttons styled by `.md-zoom button` (view.css) | NOT, SHOULD migrate | re-creates xs button: literal 22px, radius 4px, `var(--hover, rgba())` fallback, no disabled/focus; use `IconButton`/`Button` ghost xs (`pressed` for wide), keep `.md-zoom` as the pill container |

## editor/src/SqlGraph.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 204, 207, 210 | fit / zoom in / zoom out | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm |
| 260 | graph node `<g onClick>` | svg group | NOT, EXCEPTION OK | SVG diagram node, not a button (note: no role/keyboard) |

## editor/src/SqliteView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 44 | table list entry | raw `sqlite-table` | NOT, EXCEPTION OK | flat list row (active = selected); should become `.tree-row`, not Button |
| 53, 56 | prev/next page | raw `btn btn-ghost btn-sm` (no btn-icon) | NOT, SHOULD migrate | `IconButton` sm (chevron icons) or Button with icon |

## editor/src/SqlSteps.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 80 | severity filter chips | raw `sqlsteps-chip is-*` + aria-pressed | NOT, SHOULD migrate | documented filter chip: use `chip`/`chip-on` in `.chips` (own class with tone colour) |
| 88 | Show all problems | raw `sqlsteps-feed` | NOT, SHOULD migrate | link-like action: `Button` ghost xs or `setting-link` |
| 99 | problem row | raw `sqlsteps-problem` | NOT, EXCEPTION OK | list row (icon + message), jump on click |
| 130 | param row (expand) | raw `sqlsteps-problem` aria-expanded | NOT, EXCEPTION OK | expandable list row |
| 163 | param use link | raw `sqlsteps-param-use` | NOT, EXCEPTION OK | inline reference link to a code location |
| 341 | panel tabs (Steps/Problems/Params) | raw `sqlsteps-tab`, role=tab | NOT, SHOULD migrate | doc lists `sqlsteps-tab` as not; use `.req-tab` |
| 350 | close panel | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm icon close |
| 375 | group head (jump) | raw `sqlsteps-group-head` | NOT, EXCEPTION OK | section caption/row that jumps, not an action button |
| 386 | step card | div role=button tabIndex | NOT, EXCEPTION OK | card containing nested buttons (cannot be a button); keyboard handled manually |
| 399 | per-step problem count | raw `sqlsteps-count is-step` | NOT, EXCEPTION OK | actionable count badge nested in card; doc says Badge (not button) |
| 462 | feeds-into link chips | raw `sqlsteps-feed` | NOT, EXCEPTION OK | inline reference links inside a data row |

## editor/src/SvgView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 142, 144 | zoom out "−" / in "+" | raw `btn btn-ghost btn-sm` text glyphs, no `btn-icon` | NOT, SHOULD migrate | `IconButton` sm (minus/plus icons) |
| 145 | 100% / actual size | raw `btn btn-ghost btn-sm` | NOT, SHOULD migrate | `Button` ghost sm |
| 146 | light/dark background | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed` (label flips) |
| 148 | Layers toggle | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed` |
| 153 | Image/Source toggle | raw `btn btn-ghost btn-sm` + aria-pressed | NOT, SHOULD migrate | `Button` ghost sm `pressed` |

## editor/src/MarkdownView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 44-47 | code-block "Copy" | `document.createElement('button')`, class `md-code-copy` | NOT, SHOULD migrate | DOM-built so no component: use `buttonClass('ghost','xs')` + copy icon; `.md-code-copy` is a bespoke rule (styles.css:836, `var(--ink-muted, inherit)` undefined token) |

## editor/src/ArchiveView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 97 | archive tree row toggle | div `archive-row` onClick | NOT, EXCEPTION OK | tree row; note no role/keyboard (use `TreeView`/`tree-row` + roving list) |

## editor/src/TableView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 23 | sortable column header | `<th onClick>` class `sortable` | NOT, EXCEPTION OK | table header sort, not a button (note: no role/keyboard) |

## sql-ui/src/PlanView.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 53 | Copy plan | raw `btn btn-sm` + Icon copy | NOT, SHOULD migrate | `Button` default sm icon copy |
| 56 | Close plan | raw `btn btn-sm`, text only | NOT, SHOULD migrate | `IconButton` sm close (or Button with icon); pane-head close |

(sql-ui/src/SqlResults.tsx: no buttons.)

## terminal/src/TerminalPane.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 534, 537 | find: match case "Aa", regex ".*" | raw `chip chip-on` + aria-pressed | OK | documented filter chip |
| 540, 543, 546 | find: prev / next / close | raw `btn btn-ghost btn-sm btn-icon` | NOT, SHOULD migrate | `IconButton` sm |
| 560 | overlay action (e.g. restart/close) | raw `btn btn-sm` (text only) | NOT, SHOULD migrate | `Button` sm; role by action (restart `default` icon rotate-ccw, close `ghost`) |

## view-terminal/src/settings/cards.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 178 | change profile icon | raw `btn btn-sm btn-icon btn-ghost` + Icon 16 | NOT, SHOULD migrate | `IconButton` sm; icon size 16 not from scale for buttons (14) |
| 187, 188, 189 | Hide/Show, Edit/Done, Delete (profile row) | raw `btn btn-sm` text only | NOT, SHOULD migrate | row actions: `Button` xs (inside rows), Delete = `danger`, add icons |
| 206 | Add profile | raw `btn btn-sm` | NOT, SHOULD migrate | `Button` sm icon plus |
| 287, 288 | pick icon / default icon | raw `btn btn-sm` (+ Icon 16) | NOT, SHOULD migrate | `Button` sm; icon size 16 |
| 304 | Reset profile | raw `btn btn-sm` | NOT, SHOULD migrate | `Button` sm icon rotate-ccw |

## view-terminal/src/TerminalSchemes.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 136, 137 | import dialog Cancel / Import | raw `btn`, `btn btn-primary` (md) | NOT, SHOULD migrate | `Button` default md + primary md; footer order already right |
| 187, 200 | Duplicate (built-in / custom row) | raw `btn btn-sm` | NOT, SHOULD migrate | `Button` xs/sm icon copy |
| 199 | Edit/Done | raw `btn btn-sm`, aria-expanded | NOT, SHOULD migrate | `Button` xs/sm |
| 201 | Delete scheme | raw `btn btn-sm` | NOT, SHOULD migrate | `Button` `danger` xs/sm, icon trash |
| 209, 210 | New / Import scheme | raw `btn btn-sm` | NOT, SHOULD migrate | `Button` sm icon plus / download-upload |

---

## Button audit: view-explorer, view-git, view-rest, view-workbench, gallery web

**Summary (table rows = control groups, incl. 6 CSS-class rows): OK 25 | NOT, SHOULD migrate 87 | NOT, EXCEPTION OK 21**

Notes: no `<IconButton>`, `buttonClass(...)`, `<a>` or `<label>` styled as a button exists in scope; the only `<Button>` user is WorkbenchScreen. "Raw+btn" = bare `<button className="btn ...">` (same look as Button, but the standard says never bare). `btn-ghost.active` is used in 2 places instead of `pressed`. Dialog/footer raw buttons are `md`; the rest are `sm` unless noted. Rows are groups of identical siblings (one table row = one group).

## app/web/src/App.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 202 | Settings (icon) | raw+btn `btn-ghost btn-sm btn-icon` + `active` class | NOT, SHOULD migrate | IconButton ghost sm `pressed={!!overlay}`; uses `.active` not aria-pressed |
| 209 | Pop out (icon) | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 214 | Command palette (icon) | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |

## app/web/src/screens/GridScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 74 | Save (primary when dirty, dirty-dot) | raw+btn sm, `btn-primary` conditional | NOT, SHOULD migrate | Button sm, variant `dirty?'primary':'default'`, icon `check`/save; keep dot as child |
| 77 | Reset | raw+btn sm | NOT, SHOULD migrate | Button sm default (icon `rotate-ccw`) |
| 78 | Restore default | raw+btn sm | NOT, SHOULD migrate | Button sm default (icon `rotate-ccw`) |
| 83 | Add (opens menu) | raw+btn sm + hand-built `menu-wrap`/`menu` | NOT, SHOULD migrate | Button sm icon plus; menu should be `ContextMenu` |
| 89 | Menu entries (removed items) | raw `menu-item` role=menuitem | NOT, EXCEPTION OK | menu item (but hand-built menu: use ContextMenu) |
| 147, 181 | Retry in ErrorBanner action | raw+btn sm + `<Icon refresh>` | NOT, SHOULD migrate | Button sm icon=refresh |

## app/web/src/screens/Home.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 12 | Retry | raw+btn sm + Icon refresh | NOT, SHOULD migrate | Button sm icon=refresh |
| 78 | Send toast (spinner/send icon) | raw+btn md | NOT, SHOULD migrate | Button md icon=send; default variant OK (not main action of dialog) |
| 115 | Send (form submit) | raw+btn-primary md, submit | NOT, SHOULD migrate | Button md primary icon=send, `type="submit"` (Button defaults to type=button) |

## app/web/src/screens/TabsScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 73 | Page switcher | raw `chip`/`chip-on` | NOT, SHOULD migrate | not a filter: it is a section tab strip -> `.req-tab`; chip is for filters |
| 95 | +1 counter | raw+btn-primary md | NOT, SHOULD migrate | Button md primary icon=plus |

## app/web/src/screens/SettingsModal.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 329 | Modified-only filter (funnel svg) | raw `settings-nav-filter`, aria-pressed, inline `<svg>` | NOT, EXCEPTION OK | embedded control inside the nav search field (own look); could use `Icon` instead of inline svg |
| 345 | Open settings file | raw+btn sm | NOT, SHOULD migrate | Button sm default icon (`file`) |
| 346 | Close (glyph) | raw+btn ghost sm icon with text `✕` | NOT, SHOULD migrate | IconButton ghost sm icon=close; uses unicode glyph, not Icon |
| 353, 355, 411 | Cross links ("see also", problems tag, child section) | raw `setting-link` | OK | documented link control |
| 366 | Nav tree items | raw `settings-nav-item` | NOT, EXCEPTION OK | settings nav item (tree-row-like), not an action button |
| 372-379 | Nav twisty `▶` | `<span onClick>` in nav item | NOT, EXCEPTION OK | disclosure caret; span with click, no role/keyboard (a11y gap) |
| 423 | Clear search | raw+btn sm | NOT, SHOULD migrate | Button sm ghost |
| 542 | Quit app | raw+btn sm btn-danger | NOT, SHOULD migrate | Button sm danger; add icon (power) |
| 583 | Remove file-pattern row | raw+btn sm in row | NOT, SHOULD migrate | Button xs (row action), ghost/danger, icon trash |
| 587 | Add file-pattern | raw+btn sm | NOT, SHOULD migrate | Button sm icon plus |
| 624 | Choose editor | raw+btn sm | NOT, SHOULD migrate | Button sm default |
| 635 | Reset editor | raw+btn sm | NOT, SHOULD migrate | Button sm ghost icon rotate-ccw |
| 789, 793, 886, 891, 908 | Backup scope/store/mode toggles | raw `chip`/`chip-on` | OK | filter-style toggle chips (no aria-pressed; 908 merge/replace is exclusive pair = future `seg`) |
| 800 | Export backup | raw+btn sm | NOT, SHOULD migrate | Button sm icon download |
| 817 | Import backup (pick file) | raw+btn sm | NOT, SHOULD migrate | Button sm icon download/upload |
| 863 | Backup dialog Close | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary |
| 866 | Import dialog Cancel | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 867 | Import now | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary |

## packages/view-explorer/src/ExplorerScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 780 | Recent project quick-open | raw `chip` | NOT, EXCEPTION OK | pill link to open a project, not a toggle filter; chip reused as pill |

## packages/view-explorer/src/settings/cards.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 83 | Reading width choices | raw `chip`/`chip-on` | OK | exclusive chip set (no aria-pressed) |

## packages/view-explorer/src/explorer/TreePane.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 66 | "More" menu items | raw `menu-item` role=menuitem(checkbox) | NOT, EXCEPTION OK | menu item (hand-built menu, backlog: ContextMenu) |
| 149, 152, 155 | New file, collapse/expand all, go to file | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm |
| 159 | More (opens menu) | raw+btn ghost sm icon, aria-haspopup | NOT, SHOULD migrate | IconButton ghost sm (+ContextMenu) |
| 202 | Filter-mode toggle | raw `chip`/`chip-on`, aria-pressed | OK | filter chip |
| 205 | Close find | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=close |

## packages/view-explorer/src/explorer/ProjectSearch.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 71 | Search-content toggle | raw `chip`/`chip-on`, aria-pressed | OK | filter chip |
| 74 | Close search | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=close |
| 94 | Search result rows (`xp-hit`) | raw own class | NOT, EXCEPTION OK | list row (own hover/disabled styles; backlog says use `.tree-row`) |

## packages/view-explorer/src/explorer/DetailsTab.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 249 | Up one folder | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=arrow-up |

## packages/view-explorer/src/explorer/FileTab.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 473 | Reload (banner action) | raw+btn sm | NOT, SHOULD migrate | Button sm default icon refresh |
| 474 | Overwrite (banner action) | raw+btn sm | NOT, SHOULD migrate | Button sm danger (destructive overwrite) |
| 480 | Make writable | raw+btn sm | NOT, SHOULD migrate | Button sm default icon unlock |

## packages/view-explorer/src/explorer/LogTab.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 116 | Dismiss (rotated banner) | raw+btn sm | NOT, SHOULD migrate | Button sm default |

## packages/view-explorer/src/explorer/CurlPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 132 | Cancel request | raw+btn sm | NOT, SHOULD migrate | Button sm danger icon=square (cancels a run) |
| 133 | Close panel | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=close |

## packages/view-explorer/src/explorer/SqlPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 53 | Params dialog Cancel | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 54 | Params dialog Run | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary icon=play |
| 66 | Hidden submit | `<button type="submit" hidden>` | NOT, EXCEPTION OK | invisible Enter-to-submit helper, never rendered |
| 198 | Cancel run | raw+btn sm | NOT, SHOULD migrate | Button sm danger icon=square |
| 199 | Copy results | raw+btn sm | NOT, SHOULD migrate | Button sm ghost icon=copy (output action) |
| 200 | Commit | raw+btn sm | NOT, SHOULD migrate | Button sm default icon=check |
| 201 | Rollback | raw+btn sm | NOT, SHOULD migrate | Button sm default icon=rotate-ccw |
| 202 | Close panel | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=close |

## packages/view-explorer/src/explorer/PropertiesDialog.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 77 | Dialog Close | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 90, 129 | Copy path / copy hash | raw+btn sm inline in field | NOT, SHOULD migrate | Button xs ghost icon=copy (inline row action) |
| 107 | Cancel size count | raw+btn sm | NOT, SHOULD migrate | Button xs danger icon=square |
| 111 | Calculate size | raw+btn sm | NOT, SHOULD migrate | Button xs default |
| 134 | Compute SHA-256 | raw+btn sm | NOT, SHOULD migrate | Button xs default |

## packages/view-git/src/GitScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 228 | File rows (list/tree) | raw `tree-row git-row` | OK | documented tree-row (selected/focus built in) |
| 259 | Folder rows | raw `tree-row git-row`, aria-expanded | OK | tree-row |
| 294 | "More" menu items | raw `menu-item` role=menuitem | NOT, EXCEPTION OK | menu item (hand-built menu; backlog: ContextMenu) |
| 311 | Header actions helper (refresh, list/tree, collapse/expand, ...) | raw+btn ghost sm icon (helper `iconButton`) | NOT, SHOULD migrate | IconButton ghost sm; helper can wrap IconButton |
| 323 | More (opens menu) | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm (+ContextMenu) |
| 360 | Section head (collapsible) | raw `tree-row git-row git-section-head` | OK | tree-row with aria-expanded |

## packages/view-git/src/git/HistoryPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 148 | Commit file rows | raw `tree-row git-row` | OK | tree-row |
| 176 | History section head | raw `tree-row git-section-head` | OK | tree-row |
| 189 | Commit rows (expand) | raw `tree-row git-commit` | OK | tree-row |
| 217 | Load more | raw `tree-row git-row git-more` | NOT, EXCEPTION OK | list-footer row; acceptable as row (alternative: Button ghost xs) |

## packages/view-rest/src/RestScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 199 | Import | raw+btn sm | NOT, SHOULD migrate | Button sm default icon=download |
| 200 | Code | raw+btn sm | NOT, SHOULD migrate | Button sm ghost icon=code |
| 201 | Save | raw+btn sm | NOT, SHOULD migrate | Button sm icon=check; is the main action -> `primary` |
| 202 | Save as | raw+btn sm | NOT, SHOULD migrate | Button sm default |
| 211 | New (saved list) | raw+btn sm + Icon plus | NOT, SHOULD migrate | Button sm icon=plus |
| 241 | Saved request rows (`rest-item-main`) | raw own class | NOT, EXCEPTION OK | list row (own hover; backlog: tree-row + roving list) |
| 246, 249 | Rename / delete (icon) | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs (row action), delete maybe danger |

## packages/view-rest/src/rest/RestTabBar.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 37 | Request tab (`div role=tab`) | `tab-chip` div | OK | documented tab-chip (workspace tab; div has no keyboard focus/tabindex) |
| 50 | Tab close x | raw `tab-close` | NOT, EXCEPTION OK | part of the tab chip |
| 66 | New tab (+) | raw+btn ghost sm icon `tab-new` | NOT, SHOULD migrate | IconButton ghost sm className=tab-new |
| 81 | History toggle | raw+btn ghost sm icon + `.active` + aria-pressed | NOT, SHOULD migrate | IconButton ghost sm `pressed={env.history}` (drop `.active`) |

## packages/view-rest/src/rest/EnvironmentsDialog.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 128 | Close | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 129 | Save | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary icon=check |
| 140 | New environment | raw+btn sm + Icon plus | NOT, SHOULD migrate | Button sm icon=plus |
| 145 | Environment rows (`rest-item-main`) | raw own class | NOT, EXCEPTION OK | list row (see RestScreen 241) |
| 150, 153 | Rename / delete env | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs |
| 186 | Replace value | raw+btn ghost sm in table row | NOT, SHOULD migrate | Button xs ghost |
| 209 | Remove variable row | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs |
| 218 | Add variable | raw+btn sm + Icon plus | NOT, SHOULD migrate | Button sm icon=plus |

## packages/view-rest/src/rest/CurlDialog.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 34 | Close | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 35 | Save | raw+btn md footer | NOT, SHOULD migrate | Button md default icon=download |
| 36 | Copy | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary icon=copy |

## packages/view-rest/src/rest/ImportDialog.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 85 | Cancel | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 86 | Save selected | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary icon=check |
| 91 | Close (done step) | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary |
| 94 | Cancel (paste step) | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 95 | Open file | raw+btn md footer | NOT, SHOULD migrate | Button md default icon=folder |
| 96 | Parse | raw+btn-primary md footer | NOT, SHOULD migrate | Button md primary |

## packages/view-rest/src/rest/HistoryPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 43 | Clear history | raw+btn sm | NOT, SHOULD migrate | Button sm ghost (pane-head action) icon=trash |
| 44 | Close panel | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=close |
| 61 | History entry rows (`rest-history-item`) | raw own class | NOT, EXCEPTION OK | list row (own grid layout and hover) |

## packages/view-workbench/src/WorkbenchScreen.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 245 | Connections | Button ghost sm icon=database | OK | source/context group |
| 247 | Run | Button primary sm icon=play | OK | the one primary |
| 248 | Run all | Button default sm icon=play | OK | secondary action |
| 249 | Cancel (while running) | Button danger sm icon=square | OK | |
| 250, 251 | Explain, Format | Button ghost sm with icons | OK | tools |
| 256, 257 | Commit, Rollback | Button default sm icon check / rotate-ccw | OK | state actions |
| 258 | Disconnect | Button ghost sm, no icon | OK | minor: no icon (none standard) |
| 263, 265, 271 | Schema, Steps, History toggles | Button ghost sm `pressed` | OK | view toggles |
| 273 | Export (menu) | Button ghost sm icon=download, aria-haspopup | OK | output action |
| 284 | Copy | Button ghost sm icon=copy | OK | output action |
| 288 | Reset doc to default | Button ghost sm, no icon | OK | |

## packages/view-workbench/src/workbench/Connections.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 80 | Modal Close | raw+btn md footer | NOT, SHOULD migrate | Button md default |
| 110 | Test connection | raw+btn md `wb-test-btn` + Icon refresh | NOT, SHOULD migrate | Button md className=wb-test-btn (allowed view-specific add); icon refresh is odd for "test" |

## packages/view-workbench/src/workbench/HistoryPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 82 | Clear history | raw+btn ghost sm | NOT, SHOULD migrate | Button ghost sm icon=trash |
| 88 | History pick rows (`wb-history-pick`) | raw own class | NOT, EXCEPTION OK | list row (multi-line content; alt-click) |
| 104 | Delete entry | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost xs (row action) |

## packages/view-workbench/src/workbench/SchemaPanel.tsx
| line | control | built with | verdict | why/deviation |
|---|---|---|---|---|
| 72 | Reload schema | raw+btn ghost sm icon | NOT, SHOULD migrate | IconButton ghost sm icon=refresh |
| 91 | Table rows (`wb-schema-table`) | raw own class, dblclick/context menu | NOT, EXCEPTION OK | tree row with own look (backlog: tree-row) |
| 187 | FK jump link | raw `wb-schema-fk` | NOT, EXCEPTION OK | inline link inside a column row (like setting-link); own accent text |
| 206 | Show DDL | raw+btn ghost sm `wb-schema-ddl` + Icon code | NOT, SHOULD migrate | Button ghost xs icon=code (inside a section) |

## CSS classes styling buttons in scope
| file:line | class | verdict | note |
|---|---|---|---|
| packages/view-explorer/src/explorer.css:17-22 | `.xp-hit` | NOT, EXCEPTION OK | result row; own padding |
| packages/view-rest/src/rest.css:16-17, 29 | `.rest-history-item`, `.rest-item-main` | NOT, EXCEPTION OK | list rows, border:0 literal 5px padding |
| packages/view-workbench/src/workbench.css:3 | `.wb-test-btn` | OK | allowed addition on `.btn` (margin only) |
| packages/view-workbench/src/workbench.css:11-12, 23-25, 30-31 | `.wb-schema-table`, `.wb-schema-fk`, `.wb-history-pick` | NOT, EXCEPTION OK | own row/link styles; literal px padding (3px) |
| packages/view-workbench/src/workbench.css:26 | `.wb-schema-ddl` | OK | margin-only addition |
| packages/ui/src/styles.css:1079-1097 | `.settings-nav-filter`, `.settings-nav-item` | NOT, EXCEPTION OK | settings nav (shared ui css) |
