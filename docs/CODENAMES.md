# Kedalion codenames

Kedalion is the smith's guide of Greek myth: a helper of Hephaestus who rode on the shoulders of the blinded Orion and steered him east to the rays of Helios, which restored his sight. The app is that guide: it sits on top of strong but blind machinery and steers it for its owner. **Hephaestus is the user**, the smith Kedalion helps. No part of the code carries his name, and Kedalion did not come from him.

Internal codenames for the app, its views and its packages, taken from Greek mythology. They appear in docs and code comments only. Menu labels, package ids (`view-explorer`, `@kedalion/ui`) and persisted identifiers stay as they are.

The app icon and the view icons draw on these names; their stories are in [ICONS.md](ICONS.md).

The scheme follows three groups:

- **Olympian** is the foundation: the app, the shared base, the server core, Agents and Settings.
- **Hero** is every view that runs something, and the package behind it.
- **Smith** is the shared tools and build tooling, the workshop of Hephaestus.

## App

| Codename | Applies to | Why |
|---|---|---|
| **Kedalion** | The whole app | Chosen by the owner. The guide who sits on strong, blind machinery and steers it; he helps Hephaestus, the user. |

## Views

| Codename | Group | Applies to | Why |
|---|---|---|---|
| **Theseus** | Hero | Explorer | He walks into the Labyrinth (the file tree) and finds his way through it by following a thread. |
| **Charon** | Hero | Terminal | The ferryman who carries you across to the other side; a terminal carries commands to the system and brings the output back. |
| **Hermes** | Hero | REST | The messenger god: carries a request out and the reply back, fast, between two parties that never meet. |
| **Sibyl** | Hero | Workbench (SQL) | A prophetess who answers the questions people bring her; a query is a question and the result is the answer. |
| **Moirai** | Hero | Git | The Fates who spin, measure and cut the thread of each life: commits are the thread of the code, and a revert cuts it. |
| **Argus** | Hero | Dashboard | The giant with a hundred eyes who never stops watching; a dashboard is many eyes on many things at once. |
| **Odysseus** | Hero | Browser | The wanderer who visits many lands and finds his way home: a browser visits many sites and returns with what it found. |
| **Kourai** | Olympian | Agents | The golden maidens Hephaestus made to help him at the forge; they think and act on their own, like agents. |
| **Themis** | Olympian | Settings | The goddess of order and custom: how things are set and done. |

## Packages and layers

| Codename | Group | Applies to | Why |
|---|---|---|---|
| **Pantheon** | Olympian | `ui` | All the gods together in one place: all the shared components in one place. |
| **Orion** | Olympian | `server-core` | The giant hunter, strong but blind, carried by Kedalion: the server does the work and sees nothing until the UI steers it. |
| **Thyris** | Olympian | `shell` | The Greek word for a window: it is the native window that holds the web UI. |
| **Hestia** | Olympian | `platform` | Goddess of the hearth: the home on the operating system, where the app sits (tray, autostart, files). |
| **Pithos** | Olympian | `db` | The big storage jar of myth (Pandora's jar): it holds what the app keeps. |
| **Iris** | Olympian | Theme and palette | The goddess of the rainbow: colour. |
| **Obol** | Hero | `terminal` | The coin paid to Charon for the crossing: the small package behind the Terminal view. |
| **Tripod** | Hero | `sql-ui` | The seat on which the Pythia sat to give her answer: where the SQL answer is shown. |
| **Panoptes** | Hero | `view-grid` | "All-seeing", the epithet of Argus: the package that holds the Dashboard's panels. |
| **Telchines** | Smith | `server-mods` | The first metalworkers of myth, who made tools for the gods: a kit of ready tools (fs, http, archive, backup; update until it was removed). |
| **Cadmus** | Smith | `editor` | The hero who brought the alphabet to Greece: writing. |
| **Akmon** | Smith | `build` | The anvil of the forge; the build is where the app is hammered into an executable. |
| **Daktyls** | Smith | `scripts/` | The small craftsmen of the fingers, helpers at the bench: small tools that check and polish. |
| **Cerberus** | Olympian | The update signature check: `verifyManifest` (`server-core`), `verifiedRelease` (`server-mods/src/update.ts`) and the signing side in `build` (`keys.ts`, `release.ts`) | The three-headed dog at the gate: nothing passes unless it belongs, as an update runs only when signed. Removed with the self-updater; the name is kept for history. |

## Wordplay

Pairs where one thing becomes or spawns the other, as in the myths.

| Pair | The play | Mapping |
|---|---|---|
| **Kedalion rides Orion** | The sighted guide on the blind giant's shoulders. | The web UI is Kedalion; the server core (`server-core`) is **Orion**. Strong, does the work, sees nothing until the UI steers it. |
| **Argus has a hundred Eyes** | One watcher made of many eyes. | `view-grid` is **Panoptes**, the Dashboard is Argus. Each Dashboard panel is an **Eye**. |
| **Pilgrim consults the Sibyl** | A petitioner brings a question; the oracle answers from her seat. | A saved database connection (in `db`, the **Pithos**) is the **Pilgrim**. Opening it in the Workbench brings it to Sibyl. The result grid and explain plan (`sql-ui`) are the **Tripod**, where the answer is read. |
| **Theseus follows the Thread** | Ariadne's thread leads him through the maze and back out. | A registered project root is the **Thread**. A root opened in Explorer is the **Labyrinth**, and Theseus walks it. |
| **Charon takes the Obol** | The ferryman carries only those who pay. | A terminal session is a crossing by Charon; the `terminal` package is the **Obol** it takes. |
| **Clay becomes any form** | Prometheus shaped every creature from clay. | **Clay** is the base contract every view implements (`ServerViewDef` and its web counterpart). Each view is what the Clay became. |
| **Ore becomes Bronze** | The smith melts raw ore into finished work. | The dev run (`kedalion dev`, server plus Vite) is the **Ore**. The executable build (`kedalion build`) is the **Bronze**. Both commands live in Akmon (`build`). |

These are naming conventions for docs and comments. No type, function or command is renamed.
