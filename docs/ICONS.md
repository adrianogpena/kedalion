# Kedalion icons

The app icon and the view icons, and the story behind each. The names come from [CODENAMES.md](CODENAMES.md).

Colours: violet `#9b8cff` on the dark tile `#120d2b` is the brand. Gold stands for Helios, the sun whose rays gave Orion back his sight, and marks the mythic detail in every icon.

## App icon

| File | Use |
|---|---|
| `app/web/public/favicon.svg` | Main icon: favicon and, rendered to `.ico` by the build, the exe and window icon |
| `docs/logo/kedalion-anvil.svg` | Main icon, 64 px source |
| `packages/ui/src/components/ui.tsx` `BrandMark` | Main icon without the tile, in the header and sidebar: anvil in the accent colour, spark in `--brand-spark` |
| `docs/logo/kedalion-eye.svg` | Alternative icon |
| `app/web/public/icons/forge.png` | Alternative: anvil with spark. Chosen in Settings > Appearance > App icon (browser tab only; exe icon stays build time) |
| `app/web/public/icons/hephaestus.png` | Alternative: Hephaestus and the apprentice at the anvil |
| `app/web/public/icons/apprentice.png` | Alternative: Kedalion on the anvil under the stars |
| `docs/logo/logo-wordmark-dark.svg`, `logo-wordmark-light.svg` | Icon with the name, for dark and light backgrounds |
| `docs/logo/logo-readme.svg` | README header |

### Anvil spark (main)

A violet anvil with a gold spark rising from it. Kedalion was an apprentice at the forge of Hephaestus on Lemnos, and the anvil is that forge. In the codenames the user is Hephaestus and the build is **Akmon**, the anvil, so the icon is the workbench where the user's tools are made and used. The spark is the light Kedalion led Orion toward: the gold of Helios coming off the work itself.

### Eye of dawn (alternative)

A violet eye whose iris is a gold rising sun. Orion, blinded, carried Kedalion on his shoulders, and Kedalion steered him east until the rays of Helios restored his sight. The eye is that moment: strong, blind machinery made to see. Kept as the alternative because it reads well at 16 px.

## View icons

24 px line icons in `packages/ui/src/assets/views/`, one per view codename. Notifications show them, rendered to a PNG badge (`packages/ui/src/view-icons.ts` maps view id to file); no other screen uses them yet. Strokes use `currentColor`, so they follow the text colour in both themes. The gold accent uses `var(--icon-accent, #e8a33a)`, so a page can retheme it.

| File | Codename | View | Story |
|---|---|---|---|
| `theseus.svg` | Theseus | Explorer | The walls of the Labyrinth with Ariadne's thread (gold, dashed) running through its corridors to the centre. Theseus followed the thread in and back out; the Explorer is how you find your way through the file tree. |
| `charon.svg` | Charon | Terminal | A shell prompt over the ferryman's boat, with the gold Styx beneath. Charon carries souls across and comes back; the terminal carries commands to the system and brings the output back. |
| `hermes.svg` | Hermes | REST | The caduceus: the winged herald's staff with two gold serpents twined around it. Heralds carried it so they could pass safely between parties that never meet; a request travels the same way, out and back. |
| `sibyl.svg` | Sibyl | Workbench | A database held in a gold laurel wreath. The Sibyls spoke for Apollo, whose plant is the laurel; the query is the question brought to the oracle and the result is her answer. |
| `moirai.svg` | Moirai | Git | Commits on a line, a gold thread spun off as a branch, and a cut across it. The three Fates spin, measure and cut the thread of each life: commits are the thread of the code, and a revert cuts it. |
| `argus.svg` | Argus | Dashboard | A wide eye whose iris is a pie chart with a gold slice. Argus Panoptes, the giant with a hundred eyes, never stopped watching; the dashboard is that watcher reading the numbers. |
| `odysseus.svg` | Odysseus | Browser | A desk globe with a dashed gold route across its face. Odysseus wandered ten years across the known world to reach Ithaca; the Browser follows a route from site to site. The stand makes it an object, so it does not read as an eye. |
| `kourai.svg` | Kourai | Agents | Three figures, the centre one gold. The Kourai were the golden maidens Hephaestus built to help at the forge, who could think and act by themselves. There were many of them, as agents run side by side. |
| `themis.svg` | Themis | Settings | The scales of Themis with a gold knob on top. Themis is the goddess of order and custom: how things are set and done. |

### Forge set

A second, complete set of view icons: 256 px rounded PNG tiles in `app/web/public/view-icons/`, served at `/view-icons/<viewId>.png`. It is chosen as a whole with the Navigation icons setting (`navIcons: 'forge'`); views without a PNG fall back to the icon set, and notifications keep the SVG badges above.

- `app/web/public/view-icons/explorer.png`
- `app/web/public/view-icons/terminal.png`
- `app/web/public/view-icons/rest.png`
- `app/web/public/view-icons/workbench.png`
- `app/web/public/view-icons/git.png`
- `app/web/public/view-icons/dashboard.png`
- `app/web/public/view-icons/browser.png`
- `app/web/public/view-icons/agents.png`
- `app/web/public/view-icons/settings.png`
