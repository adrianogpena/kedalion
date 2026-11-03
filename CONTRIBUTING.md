# Contributing

Developer guide for Kedalion. For what the project is and how to use it, see [README.md](README.md).

## Requirements

[Bun](https://bun.sh) 1.3 or newer. `bun install` once at the root.

Window mode needs the OS web view: WebView2 is part of Windows 10/11; Linux needs WebKitGTK 6.0
(GTK 4): `sudo apt install libwebkitgtk-6.0-4` on Debian/Ubuntu.

## Scripts

Run at the root (they act on `app/`) or inside `app/`:

| Command | What it does |
|---|---|
| `bun run dev` | Hot reload: the server in watch mode on port 7420 plus Vite. Open the URL the server prints (`http://localhost:5173/?c=<code>`); it survives reloads, and a server restart prints a new one. |
| `bun run dev:window` | (in the app folder) The same, with a native window on the Vite URL (`bun run dev -- --app` for an app window). |
| `bun run start` | Run from source in a native window. Needs `build:web` first. `bun run start -- --app` for an app window. |
| `bun run start:browser` | Run from source in browser mode. Flags: `--port <n>`, `--no-open`. |
| `bun run build:web` | Bundle the UI into `app/dist/web`. |
| `bun run build` | Build the UI, then the executable for this machine into `app/release/`. |
| `bun run build --target all` | Executables for every target. Targets: `windows-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`; comma-separate several. `--no-web` reuses the last UI build. |
| `bun run typecheck` | Type-checks every package and app. |
| `bun test` | (root) Unit tests of the packages. |
| `bun scripts/screenshot.ts --out <png>` | (root) Screenshot of the app UI in headless Edge/Chrome, with its own `--dev` server on port 7799 and a temp home. Flags: `--hash <route>`, `--settings '<json>'` (seeds `settings.json`), `--seed '<json>'` (`{"<file>.json": value}` written beside it, e.g. `projects.json`), `--eval '<js>'`, `--size WxH`, `--wait <ms>`, `--no-build`, `--port <n>` (default 7799; distinct ports let runs overlap). |

The executable takes the same flags as the source: `--app` (Edge/Chrome app window),
`--browser` (Settings then has a Quit button that stops the app; wins over `--app`),
`--no-open`, `--port <n>`, `--open-url <uri>` (open a native window on a `<id>://open/<path>` link), `--dev` with `--window`, `--idle-exit <min>` (exit after that
many minutes without a request from an open UI; the UI sends a heartbeat every minute through
`useHeartbeat()`; never with `--dev`), `--help`.

Only one instance runs (except with `--dev`): the running one publishes its port in
`~/.<id>/instance.json`, with a secret that unlocks only `POST /api/instance/open`. A second
launch asks it to open a new window (an app window for `--app`, a browser tab for `--browser`)
and exits. Two launches at
the same moment are kept apart by `~/.<id>/instance.lock` (holds the pid of the launch that
starts the instance).

## Layout

```
packages/
  server-core/   Bun.serve server: host, Origin and token checks, launch codes, static files
                 with CSP, AppError, routes type; protocol.ts (token header, launch code
                 parameter, dev ports, error body) is shared with the UI
                 release.ts: platform labels of release file names
                 stream.ts: `ndjson` streaming responses
  server-mods/   Opt-in route modules: settings (GET/PUT /api/settings), info (GET /api/info),
                 records (JSON-file record store + CRUD routes), rooted-fs (/api/fs/*),
                 dialogs (/api/dialog/*)
  shell/         runApp(): parses flags, single instance, starts the server, opens a window
                 (one Worker per window, Webview.run() blocks its thread), an app window or
                 the browser
  platform/      OS-specific code: open URL, find Edge/Chrome for app windows, app data folder, error message box, processes
                 (run with timeout, kill tree, start detached); json-file (atomic writes),
                 secrets (DPAPI), dialogs (native pickers), files (reveal, open), trash (recycle bin);
                 win/: toasts, tray, autostart (HKCU Run key), URL protocol, PowerShell helpers; theme.ts: osThemeKind
  ui/            React components (Sidebar, Badge, ErrorBanner, Modal, Icon, ...), hooks,
                 API client, i18n engine with the base messages, hash routing, styles.css
  editor/        CodeMirror 6 editor, Milkdown rich Markdown editor and content viewers (CodeEditor, CodeView, MarkdownView, FilePreview)
  db/            Opt-in Oracle access (oracledb thin mode): URL parser, sessions with explicit
                 transactions, /api/db/* routes
  terminal/      Opt-in integrated terminal: `TerminalPane` (xterm.js client view), protocol, and server
                 sessions (real PTY, screen replay, launchers, /api/terminal/* routes)
  build/         The `kedalion` CLI used by the app scripts: dev, build:web, build
  view-*/        One package per view (Dashboard, Explorer, Git, REST, Terminal, Workbench, Agents, ...),
                 each an island, see [Adding a view](#adding-a-view)
app/             The Kedalion app (workspaces are `packages/*` and `app`)
  app.ts         Name and id
  server/        main.ts (composes routes, calls runApp) and routes.ts (the app's own API)
  web/           Vite root: index.html, public/favicon.svg (also the exe icon), src/
scripts/         Root scripts (typecheck, screenshot)
```

Packages export TypeScript source directly; there is no package build step. Every package is
private: nothing is published to npm. The data folder is `~/.kedalion`.

### Building blocks and how the app uses them

- **An endpoint**: add `'GET /api/thing': ({ query, json }) => ...` to `server/routes.ts`, then a
  method in `api` in `web/src/api.ts`. Throw `invalid(...)`/`notFound(...)` from
  `@kedalion/server-core` for errors the UI should show; add `error.<code>` to the app's i18n
  files to translate them.
- **A screen**: add its id to `SCREENS` and an entry to `NAV` and `renderScreen` in
  `web/src/App.tsx`, a file in `web/src/screens/`, and its labels to `web/src/i18n/en.ts` and
  `pt-BR.ts` (TypeScript fails until both have every key).
- **A setting**: extend `Settings` in `server/main.ts` and `web/src/api.ts`, give it a default,
  and validate it in the `apply` option of `settingsStore`; react to changes in `onChange`.
- **Themes**: `useTheme(settings)` (from `@kedalion/ui`) applies the palette of `ThemeSettings`
  (`theme`, `paletteDark`, `paletteLight`; palettes in `@kedalion/server-core/palettes`) to `<html>`.
  Make the app `Settings` extend `ThemeSettings` and render `<AppearanceFields value onChange />` in
  its settings. Style with the `var(--…)` tokens only. Pass
  `transformIndex: themeHead(settings)` (from `@kedalion/server-mods`) to `runApp`, so
  `index.html` already carries the saved palette and the first paint has its colours.
- **Keyboard shortcuts**: `useCommand(def, run, { enabled? })` (from `@kedalion/ui`) runs `run`
  on one of a `CommandDef`'s chords (`{ id, scope, label, keys, inInput?, inModal?, desktopOnly? }`;
  `scope` is `GLOBAL` or a screen id). Wrap the app in `<KeybindingProvider defs keymap scope>` to
  dispatch them from one listener: the current screen's (`scope`) commands win over global ones and
  a `Keymap` (`{ [id]: chords }`, `[]` unbinds) overrides the defaults; without a provider each
  command listens on its default keys. The pure model (`chordOf`, `normalizeChord`, `resolve`,
  `conflictsOf`, `validKeymap` for server-side settings validation) is in
  `@kedalion/ui/keybindings`. Package commands come from `paletteCommand()`,
  `tabCommands(scope)` and `explorerCommands(scope)`; list them in `defs`. Keys a focused widget
  handles itself (editor, tree and table navigation, dialogs) aren't commands.
- **Keybindings editor**: `<KeybindingsEditor defs keymap onChange scopeLabel />` (from
  `@kedalion/ui`) lists every command with its keys and edits them: change, add (up to 4) or
  remove a chord, reset one or all, filter, and "Find by shortcut" (press a chord to see what uses
  it). It refuses a chord another command uses in the same scope or in `global`. Feed it
  `useKeybindings()`'s `defs` and the settings' `keymap`, and save `onChange`'s result as
  `settings.keybindings` (the settings route validates it with `validKeymap`). The provider re-reads
  the keymap, so changes apply at once. See the app's `KeysModal.tsx`.
- **Settings and keybindings modals**: `<Modal title onClose large>` is VS Code's modal editor (80% of
  the window, up to 1400x900, maximize button). Settings (Ctrl+,) and Keyboard shortcuts (Ctrl+K Ctrl+S,
  or the link under the Settings sections) open in it over the current screen and close with Escape or
  a click outside; `#/settings` and `#/keys` links still open them. Settings rows follow VS Code's:
  bold label, description, then the control; a boolean is one checkbox labelled by its description;
  the search shows a result count and per-section counts. See `SettingsModal.tsx`.
- **File icons**: `fileIconOf(name)` → `{ icon, tone? }` and `folderIconOf(name, childFiles?)` (from
  `@kedalion/ui`) pick a built-in icon by extension or folder name (an unnamed folder of two or
  more files of one kind gets that kind's icon). `TreeView` takes `iconOf` and `iconToneOf`;
  `TabTitle` takes `icon` and `tone`. See the app's `ProjectTree.tsx`.
- **Icon-only main menu**: `<Sidebar collapsed>` shows only the icons (items keep their label and
  `hint` as tooltip); the app adds `nav-collapsed` to the `.app` element (narrow first column).
  See the app's `App.tsx`.
- **Command palette**: `useCommandPalette()` (Ctrl+Shift+P, F1) gives `{ open, setOpen }`; render
  `<CommandPalette items onClose />` (both from `@kedalion/ui`) with `PaletteItem`s
  `{ id, group, label, hint?, keywords?, run }`. `keywords[0]` doubles as a prefix that narrows
  to its group (`theme nord`). The app's `App.tsx` lists screens, themes and Quit.
- **Tab workspace**: `<TabWorkspace layout onChange renderTab titleOf newRoute scope />` (from
  `@kedalion/ui`) shows tabs in up to 4 panes: open, close (also middle-click), reorder,
  drag between panes, Back/Forward per tab (shown once a tab has history). Each tab bar has a
  Split button (Alt+click splits down; both also in its "…" menu with Close pane;
  `splitPane(layout, tabId, 'right' | 'down')`), so panes nest (a pane beside a column of two)
  with draggable dividers (`resizeSplit`); closing a pane gives its space to its neighbours.
  `layout` is a `Layout<R>` for your route type `R` (`singlePane(newTab(route))` to start); its
  optional `tree` holds the arrangement (`layoutTree(layout)`; without it, one row of panes).
  Every tab stays mounted, so hidden ones keep their state, except when its pane moves under
  another split (splitting a pane of a split in the other direction): that pane remounts.
  `renderTab` gets `navigate(route)` to change what the tab shows, and `setActions(TabAction[])`
  to put the tab's actions in the bar (`primary`: icon buttons, `menu`: the "…" menu). Alt+1..9 select a
  tab; Ctrl+T, Ctrl+W and Ctrl+Tab only in the native window (browsers keep them); these are
  `tabCommands(scope)`, `scope` being the screen id. Persist with
  `serialize(layout)` and read back with `restore(raw, isRoute)`; keep
  it in a setting.
- **Panel grid**: `<PanelGrid items defs render onChange />` (from `@kedalion/ui`) shows draggable,
  resizable panels in a 12-column grid (6 and 1 column on narrower windows). `defs` are `PanelDef`s
  `{ id, title, icon, defaultSize, minW, minH }`, `items` the `GridItem`s `{ id, x, y, w, h, collapsed? }`;
  `render(id)` returns a panel's content, the grid adds the frame (drag by the header, collapse,
  remove). Only the full-width layout is editable and reported through `onChange`; keep it in a
  setting through `useDebouncedSave`, validated on the server with `validGridItems(raw, ids)` from
  `@kedalion/ui/grid` (no React; the app's `gridLayout`), and bring a removed panel back
  with `addItem(items, def)`. Inside a panel, `PanelLoading`, `PanelNotice` and `PanelBanner`
  show loading, empty/error and offline states. `PanelFrame` also works on its own (its `menu`
  prop adds a "…" button with `ContextMenuItem`s). Panels resize from both bottom corners. Each
  panel's menu offers Rename (1–40 characters) and Change icon, stored as `title` and `icon` on
  the `GridItem` (`icon` must be a built-in icon name); `IconPicker({ value, onPick, onClose })`
  is the searchable picker over the built-in set and works on its own. Instead of autosaving, the
  Dashboard keeps a working layout next to the saved one: Save writes the setting,
  Reset returns to the saved layout, Restore default loads the factory one (`sameItems(a, b)`
  drives the unsaved dot); unsaved changes survive switching screens, not a restart.
- **Explorer layout**: `<SplitView direction sizes onResize>` (resizable panes, persist `sizes` with
  `useDebouncedSave`), `<TreeView>` (lazy tree with keyboard, drag and rename), `<ContextMenu>` and
  `<Explorer scope>` (sidebar plus tab workspace; Ctrl+B, `explorerCommands(scope)`, folds the
  sidebar). The app's Explorer screen puts them together: the sidebar shows one project tree
  at a time (`TreePane`: a `ProjectPicker` header to switch, add, edit and remove projects, then
  the tree), a split-down button adds a second tree below with its own picker and a resizable
  divider (`trees` and `treeSizes` in the `explorer` setting), and Ctrl+Shift+F
  (`explorer.search`) replaces the body of the tree you last clicked with a `ProjectSearch`
  panel (names, or names and content, over `/api/fs/search`); Escape cancels a running search,
  then closes the panel.
  VS Code-style file management comes with it: preview tabs, dirty dots and close commands in the
  tab bar (`TabWorkspace`), a status bar and toasts (`StatusBar`, `ToastProvider`), breadcrumbs,
  undo, copy/cut/paste and drag and drop inside the tree and from and to the OS, compact folders,
  file nesting, exclude patterns and sort orders (Settings → Explorer; the Settings search filters every row). **Quick Open**: Ctrl+P
  lists the files of the shown projects ranked by `fuzzyPath` (recent files first, matched letters
  bold, Ctrl+Enter opens to the side); typing `>` switches the same box to commands, Ctrl+Shift+P and
  F1 open it on commands. An app offers its file list with `useProvideQuickOpen`; without
  one the box lists commands only. The list comes from `GET /api/fs/names` (every path, excludes
  applied). **Find in the tree**: Ctrl+F (`explorer.find`) opens a find box over the tree you
  last clicked; matches are highlighted and folders show match counts, the Filter chip hides
  everything else (and lists matches in folders never opened); Enter steps through the matches.
  **Maximize pane**: Ctrl+K Ctrl+M, a double-click on a non-preview tab or the "…" menu hide the
  tree and the other panes (they stay mounted; `TabWorkspace`'s `onMaximizedChange`, `Explorer`'s
  `hidden`). **Zen mode**: Ctrl+K Z (`explorer.zen`) also hides the nav and the status bars; Esc
  twice leaves. An empty tab lists the main shortcuts from the keymap.
- **A terminal**: `@kedalion/terminal` (the app tsconfig needs `"lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"]`). Server: spread `terminalRoutes({ sessions, shell, resolveCwd, launchers })`
  (from `@kedalion/terminal/server`, `sessions = terminalSessions()`) into `routes`, and pass
  `sockets` and `onQuit: sessions.closeAll` to `runApp`; keep the shell in a setting
  (`terminal.shell`, checked with `isShellId`). Client: `<TerminalPane session cwd onSession />` in a
  tab, saving the id from `onSession` in the tab's route. Sessions survive socket drops and
  reloads (the screen is replayed on reattach); close them explicitly with `closeSession(id)` when
  the tab closes. `launchers` start other programs by id (the client sends an id and args, never a
  program; `parse` validates the args). `preview` viewers and `listSessions()` info (title, bells,
  `lastOutputAt`, `meta`) feed a session sidebar. Terminal-first keys: the pane owns the keyboard
  and only `appKeys` commands (the palette by default) pass through, by the first step of their chords (an app terminal passes Ctrl+K on to the app, not to the shell). A real PTY on every platform
  through `Bun.spawn({ terminal })` (ConPTY on Windows). The app's Terminal screen and the
  Explorer's "Open terminal here" use it.
- **Dialogs**: new dialogs use the `packages/ui` dialog components, never native ones;
  `bun run typecheck` fails on native dialog code (`scripts/check-boundaries.ts`). `<DialogHost/>`
  is mounted once per app. `dialogs.confirm/prompt/choose/pickFile/pickFolder/saveAs` (from
  `@kedalion/ui`) return a promise: await it; it is `null` on cancel. `purpose` names the
  dialog's remembered start folder; `filters` is `{ name, patterns: string[] }[]` (globs such as
  `*.md`). The dialog's OK commits the path to `stores.picks`, and a save or open route that takes
  the path back must `take` it from there, so a client can't hand in any other absolute path.
  A confirm the server starts goes through `stores.ui.confirm`.
- **DataTable**: `<DataTable columns rows rowKey />` windows its rows (fixed row height), sorts,
  resizes columns (`widths` + `onWidthsChange` to persist), selects and copies. `toCsv` and `toTsv`
  build exports. `groupOf(row)` keeps rows of a lower group first whatever the sort (folders before
  files; `sortRows(rows, value, dir, group?)` does the same) and `onKeyDown` handles keys on the
  table; the Explorer's details view uses both.
- **Editor and viewers**: `@kedalion/editor`. `CodeEditor` (Ctrl+Enter runs
  `onRun`), `CodeView`, `MarkdownView`, `JsonTree` (from `@kedalion/ui`) and `FilePreview`
  (picks a viewer by file name: markdown, JSON tree, log, highlighted code, CSV/TSV table,
  Jupyter notebook, HAR, `.env`, image, SVG, audio/video, PDF, archive, SQLite, font, else hex
  for binaries; PDF, SVG and font viewers load lazily). The app's `FileTab.tsx` shows how
  each kind gets its content from `/api/fs/*`. `MarkdownEditor` (`value`, `onChange`, `mode`: `'rich' | 'source'`, `host`, `wrap?`, `toc?`, `resolveImage?`) edits markdown in place. `rich` is a Milkdown pane (toolbar, tables, code blocks with highlighting, Mermaid, heading outline, zoom and reading width); `source` is the raw text in CodeMirror. The host shows the mode switch (the app has a Source toggle in the tab bar) and passes `host` (`RichHost`: `filePath`, `onOpenPath`, `pickFile`, `saveAs`, `resolveImage?`, `settings`). `onChange` fires only after a user edit, so an untouched file keeps its bytes. The rich pane lives in `packages/editor/src/rich/`: `RichMarkdown.tsx` (editor and round trip), `format.ts` and `Toolbar.tsx` (formatting, toolbar), `tables.ts`, `codeBlock.ts`, `mermaid.ts`, `nav.ts` and `navLinks.ts` (heading picker, outline, links), `view.ts` (zoom, reading width), and `features.ts` (the list). To add a feature, write a `RichFeature` (`plugins?`, `handlers?` per command id, `Overlay?`) as defined in `rich/commands.ts`, add the command id to `RICH_COMMAND_IDS`, and append the feature to `FEATURES` in `features.ts`; give the command a key in `MARKDOWN_KEYS` (`view-explorer/src/commands.ts`) and labels. Files that tests import must not import `@kedalion/ui` at runtime. Import Milkdown from its separate packages, not `@milkdown/kit`. The rich pane loads lazily (`React.lazy`, its own chunk) and Mermaid loads by dynamic `import()`; set `chunkSizeWarningLimit: 900` in `vite.config.ts`, as the app does.
- **File associations**: `setFileAssociations(list)` (from `@kedalion/ui`) makes files whose
  name matches a glob (`*`, `?`, case-insensitive) open and get icons as another extension, e.g.
  `{ pattern: '*.out', as: 'log' }`; `effectiveName(name)` applies it. Keep the list in a setting
  validated with `validFileAssociations` (`@kedalion/ui/file-associations`). The app's
  Settings have a File types section.
- **Streaming**: `ndjson(req, async (emit, signal) => ...)` in a route streams items without
  buffering; `useStream().start(path, params)` reads them into state (`cancel()` aborts) and
  `<OutputPanel lines />` shows log lines. See `GET /api/demo/rows` and the Workbench screen.
- **Records**: `recordStore({ dir, name, validate })` keeps items in a JSON file, and
  `recordRoutes(store, '/api/things')` exposes list/get/create/update/delete. In the UI,
  `ResourceList` and `ResourceForm` edit them. `secretFields: ['token']` with `secrets: secretStore(APP.id)`
  moves those fields into the secret store; the UI only sees `{ hasSecret: true }` and server code reads the
  value with `store.secret(id, 'token')`.
- **REST client**: `httpExecutor()` and `httpRoutes(executor, { secretHeaders })` (from
  `@kedalion/server-mods`) serve `POST /api/http/send` and `/api/http/save`; the UI is
  `RequestEditor` and `ResponseView` from `@kedalion/editor` (pure helpers in
  `@kedalion/editor/http`). `secretHeaders(ref, url)` returns headers to add from a stored
  secret (the app sends a saved Authorization only to the origin it was saved with).
  `validateDraft(raw)` checks a saved `HttpRequestDraft` (call it in the store's `validate`); the
  limits it shares with the send route and the editor are the `HTTP_*` constants in
  `@kedalion/server-core/protocol`. Limits: 10 MB response body, 60 s default timeout,
  http/https URLs only. See the REST screen.
  Import: `parseCurl(text)` (browser "Copy as cURL", bash and cmd forms) and `parseHttpFile(text)`
  (VS Code REST Client / IntelliJ `.http`: `###`, `@var`/`{{var}}`, `# @name`) from
  `@kedalion/editor` return `ImportedRequest`s: `{ name?, draft, auth?, warnings }`, with the
  Authorization value taken out of the headers into `auth` (the secret field) and `warnings` as
  `<code>:<argument>` strings to translate; `parseImport(text)` picks cURL or `.http`. A file
  import: the client picks the file with `dialogs.pickFile`, and a route reads the picked path and
  returns only `{ name, text }`, never the path (`POST /api/requests/import-file`, 1 MB at
  most); the client parses and saves.
  `RequestEditor` has Params and Auth tabs and form and multipart bodies; the draft round-trips
  to curl and `.http`. Environments: `variableResolver(vars)` (`rest-env.ts`) resolves `{{name}}`
  on every send; `httpRoutes` options `environmentVars(id)` (variables of the request's
  `environment`) and `onSend(entry)` (history). An unknown `{{x}}` fails with `unknownVariable`.
  The app serves `/api/rest/environments` and `/api/rest/history` (`rest/HistoryPanel.tsx`).
- **Rooted file system**: `rootedFs({ roots })` serves `/api/fs/*` (list, read, write, create,
  rename, move, delete, search; `raw` for binary content, with `limit=<bytes>` for the first
  bytes only; `sqlite` for a read-only page of 200 rows of a table). Requests carry a root id and a relative path, never an absolute
  path; deletes go to the recycle bin and a root can be `readOnly`. A link is never followed out
  of its root, but a path swapped between the check and the use (TOCTOU) is not guarded against.
  Archives: `POST /api/fs/extract {root,path,to}` and `POST /api/fs/compress {root,paths,name,format}`
  (`FsExtractRequest`, `FsCompressRequest` in `@kedalion/server-core/protocol`) run 7z-wasm in
  `archive-worker.ts`, which `packages/build/src/build.ts` ships as an extra entrypoint of the exe.
  Properties: `GET /api/fs/info|du|hash` (the app's Properties dialog).
- **Git (read-only)**: `gitRoutes(opts)` (from `@kedalion/server-mods`, `git.ts`) serves
  `GET /api/git/repos|status|file|diff`; the types (`GitStatus` and others) are in
  `@kedalion/server-core/protocol`. The app uses it for Explorer git badges (setting
  `git.explorerDecorations`: coloured files, status letters, a dot on folders with changes) and
  Compare files. `<DiffView original modified lang mode onModeChange modeLabels ref />` (from
  `@kedalion/editor`) shows a split or inline diff; `ref` has `next()` / `prev()` (F7 / Shift+F7).
- **Secrets**: `secretStore(appId)` (from `@kedalion/platform`) encrypts values with the Windows
  user's DPAPI key; pass it as `secrets` to a `recordStore`. Routes must return `hasSecret`, never the value.
  Tested on Windows only.
- **Opening files**: `revealInFolder` and `openWithDefault` (from `@kedalion/platform`); the
  latter opens only documents, images and media (`isOpenable`), never programs or scripts.
- **Startup work** (timers, update checks): put it in `runApp`'s `onStart`, which a launch that
  hands off to a running instance never reaches.
- **Notifications** (Windows): `createToaster()` from `@kedalion/platform`, then
  `toaster.show({ title, body, launch })`; a click opens `launch`. Use `ctx.link(path)` (the
  context `onStart` and `routes(ctx)` get) as `launch`, so the click opens the app on `#<path>`. Test with
  `bun packages/platform/src/win/toast.ts --selftest`.
- **Deep links** (Windows): `urlProtocol: true` in `runApp` registers `<id>://` for the exe at
  startup (the app id must be a valid URL scheme); `<id>://open/<path>` then opens a native
  window on `#<path>`, through the running instance when there is one. Windows starts the exe
  with `--open-url <uri>`. Remove the registration with
  `reg delete HKCU\Software\Classes\<id> /f`.
- **Tray** (Windows): `tray: true` in `runApp` shows the exe's icon in the notification area
  (a generic icon from source; none with `--dev`), with "Open <name>" (also on double-click)
  and "Quit". Closing the last window then keeps the app running, and it exits when idle only
  with `--idle-exit`. Pass `tray: { openLabel, quitLabel, items: [{ id, label, run }] }` for
  other labels and more entries between those two (ids must not start with `__`). The app
  reads it from a setting at startup, so a change takes effect after a restart. Test with
  `bun packages/platform/src/win/tray.ts --selftest`.
- **Log viewer**: `<LogView lines highlights onHighlightsChange ... />` (from `@kedalion/ui`)
  shows log lines with level colours and counts, search (case, whole word, regex), find-this-word
  on double-click and highlight chips; with `follow`/`bookmarks` props it also follows the end and
  keeps bookmarks. `useLogTail(fetchChunk, { key })` polls `GET /api/fs/tail` (from
  `rootedFs`) into `lines`; `POST /api/fs/save-range` writes everything after a byte offset
  to a file picked in the save dialog. A bookmark is a byte offset, so it goes stale when the file
  is rotated or cleared (shown as stale; copy and save answer `rangeStale`) and does not follow a
  rename. The app's `LogTab` (Explorer, `.log` files) persists highlights and bookmarks in
  the `logs` setting, capped and validated by `validLogSettings` (`@kedalion/ui/log`, with `LogSettings` and the
  `MAX_*` limits): it drops invalid entries instead of rejecting the whole value, so a client that
  passes its state through it holds what the server saves.
- **Open in editor**: `editorRoutes({ dir, fs })` (from `@kedalion/server-mods`, with a `rootedFs`)
  serves `/api/editors` (list, pick, override, open) for VS Code and IntelliJ IDEA. `findEditor`
  (platform) detects the real `.exe` (`code.cmd` on PATH leads to `Code.exe`; IntelliJ comes from the
  Toolbox script or the install folders); `openInEditor` opens the project folder, plus a file and
  line. The client never sends a program: it comes from detection or from an override chosen in a
  server-side file dialog (saved in `editors.json`). `.cmd` scripts are refused because they would
  go through `cmd.exe`, which interprets `&`, `%` and `^` in a project path. The app adds the
  entries to the Explorer's context menu and an External editors section to Settings.
- **Backup**: `backupRoutes({ app, settings, stores, excludeSettings })` (from `@kedalion/server-mods`)
  serves `/api/backup/*`: export writes the settings and the chosen record stores to a file picked
  in the save dialog; inspect reads a file picked in the open dialog (other app ids and malformed
  files are refused) and keeps it under a one-shot token for 10 minutes; import applies the chosen
  parts. The file is JSON: `{ format: 'kedalion-backup', version: 1, app, appVersion, exportedAt,
  settings?, records?: { <store>: Rec[] } }`. Settings go through `settings.save`, so its validation
  drops unknown fields; records go through `store.importItems(items, 'merge' | 'replace')`, which
  runs `validate` (with `ctx.imported`) per item and reports skipped ones with their error code.
  Secret fields are never exported and imports never change them: the user enters them again.
  Leave machine-specific settings out with `excludeSettings` (the app excludes `autostart`
  and `port`). The app's Settings have a Backup section.
- **Oracle database**: `@kedalion/db` (it bundles the `oracledb` driver in thin mode: pure JS, no Instant Client). The app
  keeps the connections in a `recordStore` with `validate: validConnection` and
  `secretFields: ['password']`, and wires `dbRoutes({ sessions: dbSessions(), credentials })`,
  where `credentials(id)` reads the record, turns its `url` into a connect string with
  `parseOracleUrl(url).connectString` and adds `secret(id, 'password')` (null for an unknown id).
  Accepted URLs: `jdbc:oracle:thin:@host:port/service`, `oracle:thin:@host:port/service`,
  `@//host:port/service`, `host:port/service` (port 1521 when left out in the last two) and the
  SID form `oracle:thin:@host:port:SID`; descriptors and TNS aliases are refused (`badDbUrl`).
  Routes: `POST /api/db/connect {id}` → `{ connected, pending, busy }`; `POST /api/db/run
  {id, sql}` runs one statement (a trailing `;` and a `/` line are dropped, PL/SQL keeps its `;`)
  and returns `{ kind: 'rows', run, columns: [{ name, type }] }` for a query, then
  `GET /api/db/rows?run=` streams the rows as NDJSON arrays (`useStream`; at most 100 000, then
  `{ $truncated: true }`); other statements return `{ kind: 'done', rowsAffected? }`.
  `run` takes an optional `maxRows` (1 to 100 000, never above the sessions' limit): the stream
  ends after that many rows with `{ $truncated: true }` when there are more.
  `GET /api/db/schema?id=&owner=` lists the tables, views and columns of a schema owner (default:
  the session's current schema) plus the owners to choose from, for a schema browser and SQL
  completion (`CodeEditor` `sqlDialect="plsql"` + `sqlSchema`).
  `POST /api/db/cancel|commit|rollback|disconnect {id}` and `GET /api/db/status?id=` report the status
  (`cancel` breaks the executing statement and drops an unfetched result; a new `run` drops one too).
  Transactions are explicit: nothing autocommits, DML and PL/SQL blocks set `pending`, DDL
  clears it (Oracle commits it), and disconnecting or 15 minutes without a call rolls back. One
  session per connection, one statement at a time (`dbBusy`); changing a connection's URL, user
  or password reconnects, refused with `dbPendingChanges` while changes are pending. Numbers
  arrive as strings (precision), dates as ISO text, binary values as `<binary n bytes>`. Driver
  errors become `dbLogin`, `dbUnreachable` or `dbError` (the first line, full text in `detail`),
  with the password replaced by `***`. Call `sessions.close(id)` when a connection record is
  deleted (a process that exits drops its sessions and Oracle rolls them back).
  The app's Workbench is the example: `server/routes.ts` keeps the `dbConnections` store
  (also in the backup, without passwords) and spreads `dbRoutes`; the Source select picks Demo
  rows or a connection, "Connections…" opens `workbench/Connections.tsx` (`ResourceList` +
  `ResourceForm`, password shown as "Saved", Test button), and while a connection is the source a
  bar shows an "Uncommitted changes" badge with Commit, Rollback and Disconnect; a "Max rows" field (default 1000, kept in the settings) limits each query, and
  the Schema button opens a sidebar with the tables and columns whose names also feed completion.
  SQL history: `dbRoutes({ ..., history: sqlHistory({ dir, max }) })` (`sqlHistory` from
  `@kedalion/db`, `history.ts`) records every run and serves `GET /api/db/history` and
  `POST /api/db/history/delete|clear`; the Workbench shows it in `workbench/HistoryPanel.tsx`.
  `POST /api/db/explain {id, sql}` returns the plan rows (not recorded in the history) and
  `GET /api/db/table` the details of a table, with its DDL.

## Adding a view

Each view is its own `view-*` package, an island that reaches only what it needs from the others. The views are not for building other apps; the separation is for isolation.

1. Create: copy the shape of an existing `packages/view-<id>` (package.json, `src/view.tsx`, server entry), register it in `app/web/src/views.ts`, `app/server/views.ts` and `app/package.json`, then run `bun install`.
2. Boundaries: a view must not import another `view-*` package, and no package imports from `app/`. `scripts/check-boundaries.ts` enforces this; it runs in `bun run typecheck` and in CI. Exceptions go in its `ALLOWED` set.
3. View links: a view registers a link with `views.link`. Another view calls `useViewLink(id)`, which returns null when the target view is absent, or `useViewRequest(id)` to receive requests. Both live in `packages/ui/src/views.ts`.
4. Capabilities: when two views need the same code (SQL/db, HTTP, git), put it in a shared non-view package and depend on that, not on the other view.
5. Settings cards: set `ViewDef.settingsCards`; write the cards in `src/settings/cards.tsx` and wire them in `view.tsx`.
6. Design: buttons, headers, rows, tabs, states and menus follow [docs/DESIGN.md](docs/DESIGN.md); use `Button`/`IconButton` and the shared components, not view-specific copies.

The Agents view lives in `packages/view-agents`.

## Browser view

The internal browser (`packages/view-browser`) is the default target for links in the app.

- Engine: headless Edge or Chrome driven over CDP by `packages/cdp` (`launch.ts` holds the flags in `browserArgs`, `tabs.ts`/`page.ts`/`input.ts` the tab, page and input calls, `logs.ts` the console and network capture, `screencast.ts` the frames). The profile is `~/.kedalion/browser-profile`. It starts lazily on first use and is killed when Kedalion quits. Set `browser.executable` to pick a binary.
- View package: `src/server.ts` wires the server half (`src/server/service.ts` engine and tabs, `routes.ts` under `/api/browser/*`, `socket.ts` live frames, console and network messages, `settings.ts`); `src/view.tsx` and `BrowserScreen.tsx` are the web screen, with `Viewport`, `ConsolePane`, `NetworkPane`/`NetworkDetail` and `DevToolsPane` (real Chrome DevTools, for breakpoints and Performance traces).
- Link routing: `installLinkRouter` (`packages/ui/src/links.ts`, installed in `app/web/src/App.tsx`) catches clicks and `window.open` of http(s) URLs outside the app and picks `internal` (Browser view) or `external` (`POST /api/browser/open-external`). The scope is the chain of `data-link-scope` ancestors, innermost first: `view:<id>` on each view root (set by `App.tsx`, so a new view gets a scope for free) and `panel:<kind>` on each Dashboard panel item (so a new panel does too). The innermost scope with a setting in the settings group `links` wins, else the global setting; the settings page is `app/web/src/screens/LinksSettings.tsx`. Right-click on a link offers Kedalion browser, default browser and copy.
- MCP endpoint: `POST /api/browser/mcp` (Streamable HTTP, plain JSON; an unauthenticated route that checks its own `Authorization: Bearer <secret>`, random per app start). `<appHome>/browser/mcp.json` is rewritten at each start, and Kedalion-launched `claude` sessions get `--mcp-config` pointing to it while `browser.agentTools` is on.
- Adding a browser MCP tool: add an `McpTool` (`name`, `description`, `inputSchema`, `run`) to `src/server/mcp/tools-page.ts` (`pageTools`) or `tools-debug.ts` (`debugTools`); `server.ts` serves both. A failing tool must return `failResult(message)` (a normal result with `isError: true`), never throw a protocol error, and cap its text output at 20 000 characters with a hint naming the parameter that fetches more. Add a test next to the file.

## Releases

The version comes from `app/package.json`. Executables are named
`<Name>-<version>-<win|linux|mac>-<arch>[.exe]`.

To publish a release:

1. Bump `version` in `app/package.json` and commit it.
2. Tag the commit `kedalion-v<version>` and push the tag:

   ```sh
   git tag kedalion-v0.3.1 && git push origin kedalion-v0.3.1
   ```

3. `.github/workflows/release.yml` checks the tag against `app/package.json`, builds every
   target on a Windows runner and publishes the executables as a GitHub release (no draft step).

The app does not update itself. Users update by downloading the new executable from the
[releases](https://github.com/adrianogpena/kedalion/releases), or by building from source:

```sh
git clone https://github.com/adrianogpena/kedalion.git
cd kedalion
bun install
bun run build
```

`bun run build` writes the executable for this machine to `app/release/`; `--target all` builds
every target.

`.github/workflows/ci.yml` type-checks, runs the tests and builds a Linux executable for every
push and pull request.

### Platform notes

- **Windows**: the exe has no console window, so `--browser` mode from the exe runs in the
  background with nothing to close: stop it with the Quit button in Settings, or let it end by
  itself 10 minutes after the last tab closes (idle exit; not when the app has a tray icon,
  whose menu has Quit).
  WebView2 keeps its profile in `%APPDATA%\<exe file name>\`. The webview library passes that
  folder itself, so `WEBVIEW2_USER_DATA_FOLDER` has no effect, and a renamed exe
  starts with a fresh profile. App state belongs on the server (`~/.<id>`), not in
  `localStorage`. Unsigned executables trigger SmartScreen on first run ("More info" → "Run
  anyway").
- **Linux**: `chmod +x` the file. Window mode needs WebKitGTK (see Requirements).
- **macOS**: the output is a plain executable, not an `.app` bundle, and it is unsigned:
  `xattr -d com.apple.quarantine <file>` after downloading. Not tested on a Mac yet.

## Security model

The server binds to `127.0.0.1` only. Every `/api` call needs the random token generated at
start, sent in the `x-kedalion-token` header only; a token in the URL is ignored. The token
never appears in a URL, because URLs land in browser history, command lines and terminal output.
A terminal WebSocket can't send headers, so it takes a one-time, short-lived ticket in `?t=`
(issued by `POST /api/terminal/open|attach`, which need the token) and still passes the Host and Origin checks.

- **Launch codes**: every URL the app opens or prints carries a one-time code (`?c=<code>`)
  instead. The UI removes it from the address bar at once and trades it for the token at
  `POST /api/session`, then keeps the token in `sessionStorage`. A code works once and expires
  after 60 s, so a leaked URL is useless ("This link was already used"). In `--dev` the code is
  reusable for the server's lifetime, so the printed URL survives reloads.
- **Origin check**: a request with an `Origin` header must come from the app's own address
  (`127.0.0.1`, `localhost` or `[::1]` on its port; in `--dev` also Vite's), else 403. Requests
  whose `Host` header is not a loopback name are rejected, which blocks DNS rebinding.
- **CSP**: `index.html` is served with a Content-Security-Policy that allows scripts, fonts and
  API calls from the app only, inline styles, images from the app or `data:`/`blob:` URLs, and
  audio/video from the app or `blob:` URLs.
  Every static file gets `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- **File dialog**: `/api/file-dialog/*` lists any folder on disk, but returns names, kind, size
  and mtime only, never contents. `mkdir` takes one name segment. Write routes accept only paths
  the dialog committed. All of it sits behind the loopback bind, the Host and Origin checks and
  the token.
- **HTTP executor**: sends only the headers the user set, never the session token, and accepts
  only http/https URLs.
- In the native window, links to other origins open in the default browser, never inside the
  app window.

To drive the API with curl, trade a printed code first:
`curl -X POST http://127.0.0.1:<port>/api/session -d '{"code":"<code>"}'`, then send the returned
token as `x-kedalion-token`.

## Icon packs

Three packs live in `packages/ui/src/assets/icons/` (`original`, `material`, `atom`). The Material and
Atom packs are compiled into `packages/ui/src/icons.ts` by `bun scripts/build-material-icons.ts` and
`bun scripts/build-atom-icons.ts`; each reads the pack's `mapping.json`. Rerun the script after
changing a pack or its mapping.

## Adding a dashboard panel

The Dashboard view (`packages/view-grid/src/dashboard/`) reuses the grid panel contract (`definePanel`,
`defineSource`, `PanelField`). Panels live in area folders `packages/view-grid/src/panels/<area>/`
(`github`, `jira`, `calendar`, `feeds`, `misc`). Every area folder has:

- `fields.ts`: `PanelField` lists and pure types, no React.
- `server.ts`: exports `specs: GridPanelSpec[]` and `sources: DataSource[]`, no React.
- `web.ts`: exports `panels: AnyPanelKind[]` (`definePanel` calls).
- `i18n.ts`: exports `en` and `ptBR: Messages<typeof en>`.

Steps:

1. Create or extend the area folder; add the area to `panels/catalog.web.ts` and `panels/catalog.server.ts`
   (they spread `panels`, `specs`, `sources`, `en`/`ptBR`).
2. Fields: besides the grid kinds there are `multi` (list of values), `text` (multi-line, up to
   `MAX_TEXT_FIELD`), `date` and `connection` (`{kind: 'connection', connectionType, default: '', label}`;
   a picker of the saved connections with "New connection..."). Labels are i18n keys, never inline.
3. Source: `defineSource({id, fields, fetch})` in `server.ts` (route `POST /api/grid/source/<id>`); pure
   mapping code goes in its own file with a test next to it. Reach the network with `sourceFetch(url, init, {signal})`
   and throw `SourceError(code, msg)`, both re-exported by `view-grid/src/server.ts`. For a connection use
   `ctx.connection(config.connection, 'github' | 'jira' | ...)` -> `{baseUrl, user?, token}`. Server-side
   files import from `@kedalion/ui/grid` only (the React index breaks the server typecheck).
4. Error codes reach the panel as `source-not-configured|auth|rate-limited|offline|upstream`; `PanelHost` shows
   the matching notice (not-configured: Set up button; auth: Check the connection, Set up, Retry), so a panel
   needs no notice of its own. An unset required field should throw `source-not-configured`.
5. Panel: `definePanel({kind, title, description, icon, category, size, fields, load, refreshMs(config, data),
   render, allowMultiple})`; `render` gets `configure()` to open the settings form. Use the kit
   (`view-grid/src/kit`: `Chip`/`Tone` ok|warn|danger|info|neutral, `ListRows`, `StatTile`, `Sparkline`,
   `relTime`, `fmtDuration`, `hasColumn`). Icons must be built-in names. File names must differ in more than
   case from siblings (`weather.ts` next to `WeatherPanel.tsx`) or tsc fails on Windows.
6. i18n: keys are prefixed `dash.<area>.*` (panel titles, fields, empty states) and `dash.category.<area>`;
   errors `error.*` within the area. Params use single braces (`{name}`).
7. Tests for the pure parts (mappers, parsers, refresh rules) next to the files; no live network.
8. Actions: a source may declare `actions: {name: (config, payload, ctx) => result}` for writes (route
   `POST /api/grid/action/<id>/<name>`, body = payload). In the panel call `runAction(id, name, config, payload)`
   (exported by `view-grid/src/web.ts`), then `refresh()` to reload. Invalid payloads throw `invalid(code)`.
9. Streams: `streams: {name: (config, query, ctx) => Response}` for live output (route
   `GET /api/grid/stream/<id>/<name>`); build the response with `ndjson` from `@kedalion/server-core`
   (one JSON object per line). In the panel consume it with `streamSource` (web.ts); see `panels/pods/logs.ts`.
10. Panel state that is not config (tickets, meeting notes, tracked PRs): `createJsonStore({dataDir, name, parse, empty})`
   (`view-grid/src/json-store.ts`) keeps it in `<dataDir>/grid/<name>.json`; `parse` validates what is read.
11. CLI-backed panels (kubectl, podman, docker): `runCli(argv, {timeoutMs, signal})` (`view-grid/src/cli.ts`) runs
   without a shell and returns `{code, stdout, stderr}`. A missing executable throws the `tool-missing` error,
   which `PanelHost` shows as "tool not installed" (message param `{tool}`), so the panel needs no notice of its own.

Layouts (named, up to 20) and presets ("Save as preset" in the panel menu, "My panels" in Add panel) are
stored in the `dashboardLayouts` and `dashboardPresets` settings. Connections are stored server-side in
`<dataDir>/grid/connections.json` (tokens never reach the web); GitHub falls back to `gh auth token`.

## Adding an Agents panel
A tool in the Agents view is a panel module:
- Create `packages/view-agents/src/web/panels/<kind>/` with `index.tsx` exporting `panel: PanelModule` (contract in `web/workspace/types.ts`), `i18n.ts` (`en` and `ptBR`) and `style.css`.
- Register it: one import in `web/workspace/registry.ts` and one in `web/panels/i18n.ts`.
- Server routes, if any: `packages/view-agents/src/server/panels/<kind>.ts` exporting `routes(ctx)` (`PanelCtx` in `server/panels/ctx.ts`), added in `server/panels/index.ts`.
- Optional `Section` makes the panel dockable as a sidebar card; `commands` adds shortcuts.
- UI follows [docs/DESIGN.md](docs/DESIGN.md): `Button` (size `xs` in rows), tokens only, no hex.

### Live output hook (Output panel)
Foreground Bash output only reaches the transcript when the command ends. To see it while it runs, add a PreToolUse hook to your Claude Code settings (the app never edits them); the script tees stdout/stderr to `<dataDir>/agents/live/<sessionId>.log` and keeps the exit code. Background commands are left alone, and without the hook the panel works as before. The panel's empty state has a Copy-snippet button with this JSON:

```json
{ "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "bun \"/path/to/packages/view-agents/scripts/live-output-hook.ts\"" }] }] } }
```
An optional second argument sets the agents dir (default `~/.kedalion/agents`; give an absolute path).

## Adding a layout

A layout is a preset of a navigation, nav toggles, a skin, a density and per-view layouts (Settings > Appearance > Layout, Global tab and one tab per view). "Navigation" is the main menu, tab bar and status bar area; do not call it "shell".

1. New skin: add `packages/ui/src/layouts/<id>.css`, scoped under `:root[data-skin='<id>']`, `@import` it in `packages/ui/src/styles.css`, and add the id to `SKIN_IDS` in `packages/server-core/src/layouts.ts`. Other skins must look unchanged. Density rules use `data-density`, navigation rules `data-nav`.
2. New navigation: add the id to `NavigationId` and `NAVIGATION_IDS`, its structure and toggles in `layouts.ts`, and swap components with `registerNavigation('nav:<id>', { Frame, Sidebar, TabBar, StatusBar })` in `packages/ui/src/layout.tsx` (`skin:<id>` swaps parts for a skin).
3. New preset: add it to `PRESETS` in `layouts.ts`. Combinations that were never built are listed by `layoutsConflicts` and blocked in the UI with the reason.
4. New per-view layout: add it to `VIEW_LAYOUTS` and build the arrangement in that view's package.
5. Icons: a set is one of `ICON_SET_IDS`; a new one is registered in `packages/ui/src/icons.ts` (`ICON_SETS`) and covers every `IconName` (`icons.test.ts`).
6. Labels go in `app/web/src/i18n/en.ts` and `pt-BR.ts`.
7. Core behaviours must hold (views, reachability, palette, settings, i18n, accessibility, shortcuts; see [docs/DESIGN.md](docs/DESIGN.md#core-behaviours)). `bun run check:parity` checks every navigation, skin and density. Preview with `bun run dev:design`.
