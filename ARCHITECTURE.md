# Architecture

How Vrigstad Joyride is put together: where it is today, where it's going, and why. Conventions for day-to-day work are in [AGENTS.md](AGENTS.md). The migration is tracked in [#61](https://github.com/OliverRomhagen/vrigstad-joyride/issues/61).

## Today

```
tools/fetch.sh ──► data/raw/ (osm.json, tile.png)
                       │
tools/process.py ──────┴──► data/vrigstad.json
                                   │
Vite (tools/build.mjs) ── imports it ──► index.html  (from src/index.html + src/game/main.ts)
                                      └─► map.html    (from src/map.html + src/map/main.ts)
```

- Each page is one HTML file (CSS and DOM) and one big script, moved as-is into `main.ts` with `// @ts-nocheck`. Each builds to a single self-contained file (#44).
- three.js is imported from npm (`three`, `three/addons/...`) and bundled into each page (#47). Both pages keep the colour and light maths of r128, which the look was tuned with: `ColorManagement` is off and light intensities are scaled by π (`LEGACY_LIGHT`), both in `src/world/three-legacy.ts`, which both pages import. Moving to managed colour and retuning is #150.
- The game's shared state is plain data in `src/game/state.ts` (#294): `GameState` (`started`, `inCar`, `pcar`, ...) for the game itself and `ViewState` for the camera, one object each, made in `main.ts` and read by the modules. What a module owns stays in that module (`cars` in the fleet, `stars` in the police); the rest is still module-level variables in `main.ts`. The game runs one `requestAnimationFrame` loop that mixes input, simulation, rendering and HUD updates.
- `src/world/` (#48) holds the world's data and queries, with no three.js outside `mesh/` and `three-legacy.ts`: the data's types and class codes, the height lookup, the seeded random stream, building shapes and tree spots, which both pages use, and the roads, water and building footprints with their spatial queries (`nearestRoad`, `groundAt`, `inWater`, `collide`), which only the game uses so far. `src/world/mesh/` builds the terrain, the building shells, the game's road ribbons and the streetscape (below) from them. Each page keeps its own look: its ground texture, colours, house details and tree models.

### Streetscape (#187)

Sidewalks, curbs, verges, junction corners, lowered curbs, crossings, parking and street trees, from OSM where OSM says and from documented rules where it doesn't.

```
data/vrigstad.json ──► streetscape-rules.ts ──► StreetSides per road (sidewalk, curb, verge, parking per side + evidence)
   (+ streetscape-overrides.ts)                      │
                                   streetscape.ts ◄──┘  layout: strips, corners, openings, triangles, lots, tree spots
                                     │        │
              mesh/sidewalk-mesh.ts ─┤        ├─ StreetscapeIndex.surfaceAt: the walkable height (the game's groundAt)
              mesh/parking-mesh.ts  ─┘        └─ the map paints the same layout's outlines
```

- `polyline.ts` is the sampling both `RoadRibbons` and the streetscape use, so a curb starts on its ribbon's edge vertex, bit for bit.
- `streetscape-rules.ts`, `streetscape.ts` and `polyline.ts` are pure (no three.js); the mesh builders batch one surface and one markings mesh per 250 m chunk.
- Every feature carries its **evidence**: `mapped` (an OSM tag or object says it exists and where), `derived` (OSM says it exists; defaults fill the geometry), `inferred` (a rule guessed it: a street in the centre or a residential area). The evidence is computed at runtime, never stored in the JSON, so retuning the rules needs no data rebuild. `?debug=streetscape` tints by it, and `npm run data:report` sums it.
- A missing OSM tag means unknown, never "no". Explicit tags beat inference; overrides (by OSM way id, empty by default) beat both, but fixing OSM is the better fix.
- Choices hash the OSM way id (`fnv1a` in `random.ts`), never data order or the game's `rnd()`.

- The sky is one dome (`src/game/render/sky.ts`): the blue gradient, the sun's glow and procedural fair-weather clouds in a single shader, so the clouds add no draw call. Each pixel meets a gently curved cloud layer about 1.8 km up and reads a deterministic, periodic noise field there (`src/world/clouds.ts`), so the clouds stay put in the world, drift with the wind by time rather than frames, and pass with parallax. The same field in TypeScript says once a frame whether the sun is behind a cloud, and the sun's intensity eases down while it is. The clouds take their colours from the dome's sun, horizon and zenith colours and their light from the shared sun direction, so whatever drives the daylight drives them too.

This was the right shape for a prototype. It stops scaling once several people add features at the same time, which is happening now.

## Target

```
pipeline (Python, unchanged) ──► data/vrigstad.json (imported, so it's inlined in single-file builds)
                                        │
src/
  world/      shared: heightfield, terrain, roads, buildings, water, trees,
              spatial queries (nearestRoad, inWater, collide)
  game/
    sim/      pure TS game state + rules: player, vehicles, traffic, police,
              wanted level, pedestrians. step(state, input, dt). No three.js, no DOM.
    render/   three.js scene and the game's ground texture; syncs meshes
              from sim state each frame
    input/    keyboard, touch, gamepad ──► Input intents
    audio/    reacts to sim events
    loop.ts   fixed-timestep sim, interpolated render
    store.svelte.ts   HUD state the UI reads
  ui/         Svelte components: HUD, intro, menus, touch controls
  map/        map page: world/ + its own ground texture + orbit camera
              + Svelte legend
tests/
  unit/       Vitest, against world/ and game/sim/
  e2e/        Playwright smoke tests against the built pages
```

### Data flow in the game

```
 Input devices ──► input/ ──► Input intents
                                   │
                                   ▼
               ┌──────── sim.step(state, input, dt) ────────┐  fixed 60 Hz
               │  state: plain objects     events: busted,  │
               │                           star-added, ...  │
               └──────┬───────────────────────────┬─────────┘
                      │ read only                 │
                      ▼                           ▼
              render/ (three.js)          store ──► ui/ (Svelte HUD)
                                          audio/
```

### Why these boundaries

- **world/ is shared** so the game and the map can't drift apart, and so data-heavy work (mesh building, spatial indexes) is done once and tested once.
- **sim/ has no three.js** so game rules can be unit-tested in Node, run at a fixed timestep (same feel at any framerate), and later run on a server or in a worker for multiplayer (#1).
- **The UI only reads a store** so Svelte's reactivity never touches the hot loop. The game writes HUD values when they change (speed throttled to ~10 Hz), not every frame.
- **Events, not calls, between systems.** The sim says "a star was added"; the UI shows a toast, audio plays a siren, render flashes the lights. New features plug in without editing the sim.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite, multi-page | #44 |
| Language | TypeScript, strict | #44 |
| 3D | three.js, current, from npm | #47 |
| DOM UI | Svelte 5 | #51; HUD and menus only |
| Unit tests | Vitest | #52 |
| Smoke tests | Playwright | #43 |
| Lint/format | Biome | #46 |
| Deploy | GitHub Actions ──► Pages | #45 |
| Data pipeline | Python stdlib | unchanged; #60 for later options |

## Decisions

Short records so settled questions stay settled. Add one when you make a choice someone might reasonably question later.

- **Stay on three.js; no game engine.** Phaser is 2D. Babylon.js, PlayCanvas and Godot were considered; see #58 for the trade-offs and when to revisit.
- **Svelte for DOM UI, not for the scene.** Declarative scene graphs (Threlte) don't suit a hot game loop. They might suit the map viewer.
- **Supersedes #23's npm-free approach.** The module split in #23 still applies; the concatenating Python build doesn't. The project chose to grow, and types, tests and a UI layer need a bundler.
- **Still ships as one `index.html`, for now.** `vite-plugin-singlefile` inlines everything per page, so the game stays a single self-contained file. Switch to normal multi-file output when models and audio make caching worth it (see #44).
- **Modes are state machines.** Player, wanted level, police AI and app flow become explicit typed state machines in `sim/`, hand-rolled first, with XState only if quests need more (#63).
- **World meshes are returned, never added to a scene.** Each `src/world/mesh/` builder is a class that hands back its `Object3D`s and frees what it made in `dispose()`; the page adds them. So the game keeps `scene.add(...)`, and the map can mount the same objects in Threlte (#118). Each page passes its look (materials, colours, details) as options and callbacks.
- **HUD stays DOM; in-world UI uses canvas textures.** HTML-in-canvas (#56) replaces the canvas textures once browsers support it.
- **No physics engine yet.** Collisions are hand-rolled. Rapier is the candidate when crashes (#40) need more (#54).
- **Lab experiments live in `src/lab/`, one folder each, off by default (#227).** `src/lab/flags.ts` lists them, each with an English name and what it costs; `?lab=<id>,<id>` switches them on, and later the settings menu (#78) and the console (#218) set the same flags. The game reads them once, at page load, so a change there takes a reload until experiments can start and stop while it runs. Gameplay asks the flags, never the URL. Each experiment is loaded with a dynamic `import()` only when its flag is on. While the page is built as one file it still ships in that file but doesn't run; with multi-file output it becomes its own chunk. Dropping one means deleting its folder and its entry. `src/lab/hello/` is the template.
- **No ECS yet.** Plain arrays per system; revisit with miniplex when entity kinds multiply (#55).

## Coordinates and data

Metres; origin 57.3555° N, 14.4756° E; x east, z south, y up; the world spans −1100..1100 on x and z.

`data/vrigstad.json`:

| Key | Content |
|---|---|
| `size`, `n` | World side in metres (2200) and elevation grid size (89 × 89, 25 m spacing) |
| `elev` | Row-major heights in **decimetres** |
| `b` | Buildings: `p` flat `[x, z, x, z, ...]` footprint, `h` height (guessed), `k` kind |
| `r` | Roads: `c` class, `n` street name, `p` polyline; optional `i` OSM way id, `j` piece number when clipping split the way, `s` service/footway use, `sf` surface, `w` width, and per side [left, right] of the way's own direction: `sw` sidewalk state, `sww` width, `ssf` surface, `pk` street parking, `po` its orientation |
| `w` | Water polygons |
| `ww` | Waterways: `k` kind, `p` polyline |
| `l` | Land use: `k` class, `p` polygon |
| `labels` | Named places: `t` text, `x`, `z`, `k` kind |
| `pa` | Parking areas on the ground: `i` OSM id, `p` outline, `h` holes, `sf` surface, `k` kind, `cap` capacity (optional key) |
| `ps` | Parking spaces mapped as polygons: `i`, `p` (optional key) |
| `x` | Crossing nodes: `i`, `x`, `z`, `k` kind, `kb` kerb, `r`/`v` the road and vertex it sits on (optional key) |
| `kb` | Kerb nodes that are not crossings: `i`, `x`, `z`, `kb` (optional key) |
| `t` | Mapped trees, flat `[x, z, ...]`, tree rows sampled every 8 m (optional key) |

Class codes are assigned in `tools/process.py`; `src/world/data.ts` types the file and names them (`RoadClass`, `LandUse`, `BuildingKind`, `WaterwayKind`, and the streetscape's `RoadUse`, `SideState`, `Surface`, `StreetParking`, `ParkingOrientation`, `ParkingKind`, `CrossingKind`, `Kerb`). Change both together. Raw OSM tags never reach the JSON: everything is reduced to these codes, and 0 always means "not mapped".
